/**
 * =============================================================================
 * study-rag Lambda（埋め込み・任意の S3 Vectors 登録 + Bedrock フィードバック）
 * =============================================================================
 *
 * AppSync カスタムミューテーション processStudyLogFeedback:
 * - クライアントが「同一目標・保存ログ日を終端としたカレンダー7日分」のログ行を渡す（目標作成日とは独立）
 * - Bedrock Converse で JSON（goodPoints / improvePoints / nextAction）を返す
 * - VECTOR_INDEX_ARN が設定されていれば、任意で埋め込みを S3 Vectors に保存（フィードバックには使わない）
 *
 * AppSync analyzeMonthlyStudyLogs:
 * - 直近30日の日付キーで S3 Vectors GetVectors をバッチ取得し、欠けた日は DynamoDB（StudyLog GSI）で補完
 * - Bedrock で summary / goodTrends / badTrends / suggestion の JSON を返す（VECTOR_INDEX_ARN 必須）
 *
 * 手動テスト用: action indexLog | generateFeedback（JSON ボディ）
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import {
  GetVectorsCommand,
  PutVectorsCommand,
  S3VectorsClient,
} from "@aws-sdk/client-s3vectors";

const region = process.env.AWS_REGION ?? "ap-northeast-1";

const bedrock = new BedrockRuntimeClient({ region });
const s3vectors = new S3VectorsClient({ region });
const ddb = new DynamoDBClient({ region });

const VECTOR_INDEX_ARN = process.env.VECTOR_INDEX_ARN ?? "";
const EMBEDDING_MODEL_ID =
  process.env.EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0";
const TEXT_MODEL_ID =
  process.env.TEXT_MODEL_ID ??
  "jp.anthropic.claude-haiku-4-5-20251001-v1:0";
const EMBEDDING_DIMENSIONS = Number(
  process.env.EMBEDDING_DIMENSIONS ?? "1024",
);

function isAppSyncResolverEvent(
  raw: unknown,
): raw is {
  arguments: Record<string, unknown>;
  identity?: Record<string, unknown>;
  info?: { fieldName?: string };
} {
  if (raw === null || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return "arguments" in o && typeof o.arguments === "object" && o.arguments !== null;
}

function ownerFromAppSyncIdentity(identity: Record<string, unknown> | undefined): string {
  if (!identity) {
    throw new Error("未ログインのため owner を特定できません。");
  }
  const claims = (identity.claims ?? {}) as Record<string, unknown>;
  const sub = String(identity.sub ?? claims.sub ?? "");
  if (!sub) {
    throw new Error("identity から owner（sub）を取得できません。");
  }
  return sub;
}

function parseEvent(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && "body" in (raw as object)) {
    const body = (raw as { body?: unknown }).body;
    if (typeof body === "string") {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }
  return raw as Record<string, unknown>;
}

function requireEnvIndexArn(): void {
  if (!VECTOR_INDEX_ARN.trim()) {
    throw new Error(
      "環境変数 VECTOR_INDEX_ARN が空です。S3 Vectors のインデックス ARN を Lambda に設定してください。",
    );
  }
}

function assertDimensions(vec: number[]): void {
  if (vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `埋め込みベクトルの次元が想定と異なります。期待=${EMBEDDING_DIMENSIONS} 実際=${vec.length}（インデックス作成時の次元と EMBEDDING_DIMENSIONS を揃えてください）`,
    );
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? ""));
}

/** AppSync が AWSDateTime 等で渡す場合も先頭 YYYY-MM-DD を拾う */
function normalizeCalendarYmd(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? "";
}

/** processStudyLogFeedback は必ず minutes（数値）を送す。analyze には含まれない。 */
function hasProcessStudyLogFeedbackShape(args: Record<string, unknown>): boolean {
  return typeof args.minutes === "number";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** referenceDate（YYYY-MM-DD）を終端とする直近 n 日の日付キー（古い→新しい） */
function rollingLastNDaysYmd(endYmd: string, n: number): string[] {
  const parts = endYmd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const mo = parts[1] ?? 1;
  const da = parts[2] ?? 1;
  const end = new Date(y, mo - 1, da);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    t.setDate(t.getDate() - i);
    out.push(`${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`);
  }
  return out;
}

function ownerGoalPartition(owner: string, goalId: string): string {
  return `${owner}|||${goalId}`;
}

/** PutVectors と同じベクトルキー */
function vectorStorageKey(owner: string, goalId: string, logDate: string): string {
  return `${encodeURIComponent(owner)}#${encodeURIComponent(goalId)}#${logDate}`;
}

type VectorLogMeta = {
  owner?: string;
  goalId?: string;
  logDate?: string;
  logLine?: string;
};

async function fetchLogLinesFromS3VectorsForDates(
  owner: string,
  goalId: string,
  dates: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!VECTOR_INDEX_ARN.trim() || dates.length === 0) return out;
  requireEnvIndexArn();
  const keys = dates.map((d) => vectorStorageKey(owner, goalId, d));
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await s3vectors.send(
      new GetVectorsCommand({
        indexArn: VECTOR_INDEX_ARN,
        keys: chunk,
        returnMetadata: true,
        returnData: false,
      }),
    );
    for (const row of res.vectors ?? []) {
      const meta = row.metadata as VectorLogMeta | undefined;
      if (meta?.logDate && meta?.logLine) out.set(meta.logDate, meta.logLine);
    }
  }
  return out;
}

async function queryStudyLogsByOwnerGoalDateRange(
  ownerGoalKey: string,
  startYmd: string,
  endYmd: string,
): Promise<{ logDate: string; line: string }[]> {
  const table = process.env.STUDY_LOG_TABLE_NAME ?? "";
  const gsi = process.env.STUDY_LOG_GSI_NAME ?? "studyLogsByOwnerGoalKeyAndLogDate";
  if (!table) return [];
  const accum: { logDate: string; line: string }[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: gsi,
        KeyConditionExpression: "#ogk = :ogk AND #ld BETWEEN :a AND :b",
        ExpressionAttributeNames: {
          "#ogk": "ownerGoalKey",
          "#ld": "logDate",
        },
        ExpressionAttributeValues: {
          ":ogk": { S: ownerGoalKey },
          ":a": { S: startYmd },
          ":b": { S: endYmd },
        },
        ExclusiveStartKey: startKey as never,
      }),
    );
    for (const item of res.Items ?? []) {
      const ld = item.logDate?.S ?? "";
      if (!ld) continue;
      accum.push({
        logDate: ld,
        line: buildDisplayLogLine({
          logDate: ld,
          minutes: Number(item.minutes?.N ?? 0),
          satisfaction: Number(item.satisfaction?.N ?? 0),
          note: item.note?.S ?? "",
        }),
      });
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return accum.sort((a, b) => a.logDate.localeCompare(b.logDate));
}

async function buildMonthlyContextLines(input: {
  owner: string;
  goalId: string;
  referenceDate: string;
}): Promise<string[]> {
  const dates = rollingLastNDaysYmd(input.referenceDate, 30);
  if (dates.length === 0) return [];
  const startYmd = dates[0]!;
  const endYmd = dates[dates.length - 1]!;
  const ogk = ownerGoalPartition(input.owner, input.goalId);
  const fromVectors = await fetchLogLinesFromS3VectorsForDates(
    input.owner,
    input.goalId,
    dates,
  );
  const fromDynamo = await queryStudyLogsByOwnerGoalDateRange(ogk, startYmd, endYmd);
  const dynamoByDate = new Map(fromDynamo.map((r) => [r.logDate, r.line]));
  return dates.map((d) => {
    const line = fromVectors.get(d) ?? dynamoByDate.get(d);
    return line ?? `${d}: （記録なし）`;
  });
}

/** 埋め込み用テキスト（目標スコープを明示） */
export function buildEmbeddingSourceText(input: {
  goalId: string;
  goalTitle?: string;
  logDate: string;
  minutes: number;
  note: string;
  satisfaction: number;
}): string {
  const title = input.goalTitle?.trim() || input.goalId;
  return [
    `目標:${title}`,
    `日付:${input.logDate}`,
    `分:${input.minutes}`,
    `満足度:${input.satisfaction}`,
    `内容:${input.note}`,
  ].join(" / ");
}

/** 画面・プロンプト用の 1 行 */
export function buildDisplayLogLine(input: {
  logDate: string;
  minutes: number;
  satisfaction: number;
  note: string;
}): string {
  return `${input.logDate} ${input.minutes}分 満足度${input.satisfaction} ${input.note}`;
}

async function embedText(text: string): Promise<number[]> {
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify({ inputText: text })),
    }),
  );

  const json = JSON.parse(new TextDecoder().decode(res.body)) as Record<
    string,
    unknown
  >;

  if (Array.isArray(json.embedding)) {
    return json.embedding.map(Number);
  }
  const embeddings = json.embeddings;
  if (Array.isArray(embeddings) && Array.isArray(embeddings[0])) {
    return (embeddings[0] as unknown[]).map(Number);
  }

  throw new Error(
    `埋め込みレスポンスの形式が想定外です。キー確認: ${Object.keys(json).join(",")}`,
  );
}

async function putVectorForLog(input: {
  owner: string;
  goalId: string;
  logDate: string;
  vector: number[];
  metadata: { owner: string; goalId: string; logDate: string; logLine: string };
}): Promise<void> {
  const safeOwnerKey = encodeURIComponent(input.owner);
  const key = `${safeOwnerKey}#${encodeURIComponent(input.goalId)}#${input.logDate}`;

  await s3vectors.send(
    new PutVectorsCommand({
      indexArn: VECTOR_INDEX_ARN,
      vectors: [
        {
          key,
          data: { float32: input.vector },
          metadata: input.metadata,
        },
      ],
    }),
  );
}

async function generateFeedbackJson(input: {
  goalTitle: string;
  recentWindowLines: string[];
}): Promise<{ goodPoints: string; improvePoints: string; nextAction: string }> {
  const windowBlock =
    input.recentWindowLines.length > 0
      ? input.recentWindowLines.map((l, i) => `${i + 1}. ${l}`).join("\n")
      : "（参照するログ行がありません。目標名だけを手がかりに、始めの一歩を提案してください。）";

  const userPrompt = [
    "# 目標（ユーザーが設定）",
    input.goalTitle,
    "",
    "# 直近の学習記録（同一目標・日付が古い順→新しい順。保存したログ日を終端としたカレンダー7日分。記録がない日は行として明示されている場合があります）",
    windowBlock,
    "",
    "上記の推移（記録の有無・時間・満足度・内容）を根拠に、良かった点・改善点・次の具体的な一手を簡潔に示してください。",
    "次の JSON スキーマに**厳密に従った JSON だけ**を出力してください。余計な説明文や Markdown は禁止です。",
    '{"goodPoints":"","improvePoints":"","nextAction":""}',
  ].join("\n");

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: TEXT_MODEL_ID,
      system: [
        {
          text:
            "あなたは習慣コーチです。直近数日の記録の傾向を読み取り、励ましと具体策を短く返します。出力は有効な JSON のみにしてください。",
        },
      ],
      messages: [{ role: "user", content: [{ text: userPrompt }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0.4 },
    }),
  );

  const text = res.output?.message?.content?.find((b) => "text" in b && b.text)
    ?.text;
  if (!text) {
    throw new Error("Bedrock Converse からテキストを取得できませんでした。");
  }

  return parseModelJson(text);
}

type MonthlyAnalysisResult = {
  summary: string;
  goodTrends: string;
  badTrends: string;
  suggestion: string;
};

function parseMonthlyAnalysisJson(text: string): MonthlyAnalysisResult {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "");
  const obj = JSON.parse(trimmed) as Record<string, unknown>;
  return {
    summary: String(obj.summary ?? ""),
    goodTrends: String(obj.goodTrends ?? ""),
    badTrends: String(obj.badTrends ?? ""),
    suggestion: String(obj.suggestion ?? ""),
  };
}

async function generateMonthlyAnalysisJson(input: {
  goalTitle: string;
  logLines: string[];
}): Promise<MonthlyAnalysisResult> {
  const block =
    input.logLines.length > 0
      ? input.logLines.map((l, i) => `${i + 1}. ${l}`).join("\n")
      : "（直近30日分のログ行がありません。）";

  const userPrompt = [
    "# 目標",
    input.goalTitle,
    "",
    "# 直近約30日の行動ログ（S3 Vectors に保存された索引を日付キーで取得し、不足日は DynamoDB で補完した1行ずつの列です。古い日付から新しい日付の順です）",
    block,
    "",
    "上記を根拠に、月次の振り返りとして次の4項目を日本語で簡潔にまとめてください。",
    "次の JSON スキーマに**厳密に従った JSON だけ**を出力してください。余計な説明文や Markdown は禁止です。",
    '{"summary":"","goodTrends":"","badTrends":"","suggestion":""}',
    "",
    "意味の目安: summary=全体の概要、goodTrends=良い傾向、badTrends=改善ポイント、suggestion=次の一歩のおすすめ。",
  ].join("\n");

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: TEXT_MODEL_ID,
      system: [
        {
          text:
            "あなたは行動習慣のデータアナリストです。出力は有効な JSON のみにしてください。",
        },
      ],
      messages: [{ role: "user", content: [{ text: userPrompt }] }],
      inferenceConfig: { maxTokens: 1200, temperature: 0.35 },
    }),
  );

  const text = res.output?.message?.content?.find((b) => "text" in b && b.text)
    ?.text;
  if (!text) {
    throw new Error("Bedrock Converse からテキストを取得できませんでした。");
  }

  return parseMonthlyAnalysisJson(text);
}

async function executeAnalyzeMonthlyStudyLogs(
  owner: string,
  goalId: string,
  goalTitle: string,
  referenceDate: string,
): Promise<MonthlyAnalysisResult> {
  if (!VECTOR_INDEX_ARN.trim()) {
    throw new Error(
      "月次分析には S3 Vectors のインデックスが必要です。Lambda に VECTOR_INDEX_ARN を設定してください。",
    );
  }
  const lines = await buildMonthlyContextLines({ owner, goalId, referenceDate });
  return generateMonthlyAnalysisJson({ goalTitle, logLines: lines });
}

type LogPayload = {
  goalId: string;
  logDate: string;
  minutes: number;
  note: string;
  satisfaction: number;
};

/** VECTOR_INDEX_ARN があるときのみベクトル登録 */
async function executeIndexLog(
  owner: string,
  p: LogPayload & { goalTitle?: string },
): Promise<void> {
  if (!VECTOR_INDEX_ARN.trim()) return;
  requireEnvIndexArn();

  const embedSource = buildEmbeddingSourceText({
    goalId: p.goalId,
    goalTitle: p.goalTitle,
    logDate: p.logDate,
    minutes: p.minutes,
    note: p.note,
    satisfaction: p.satisfaction,
  });
  const vec = await embedText(embedSource);
  assertDimensions(vec);

  const logLine = buildDisplayLogLine({
    logDate: p.logDate,
    minutes: p.minutes,
    satisfaction: p.satisfaction,
    note: p.note,
  });

  await putVectorForLog({
    owner,
    goalId: p.goalId,
    logDate: p.logDate,
    vector: vec,
    metadata: { owner, goalId: p.goalId, logDate: p.logDate, logLine },
  });
}

async function executeGenerateFeedback(
  owner: string,
  p: LogPayload,
  ctx: { goalTitle: string; recentContextLogLines: string[] },
): Promise<{ goodPoints: string; improvePoints: string; nextAction: string }> {
  void owner;
  void p;
  return generateFeedbackJson({
    goalTitle: ctx.goalTitle,
    recentWindowLines: ctx.recentContextLogLines,
  });
}

function parseModelJson(text: string): {
  goodPoints: string;
  improvePoints: string;
  nextAction: string;
} {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "");
  const obj = JSON.parse(trimmed) as Record<string, unknown>;
  return {
    goodPoints: String(obj.goodPoints ?? ""),
    improvePoints: String(obj.improvePoints ?? ""),
    nextAction: String(obj.nextAction ?? ""),
  };
}

export const handler = async (event: unknown): Promise<unknown> => {
  if (isAppSyncResolverEvent(event)) {
    const args = event.arguments as Record<string, unknown>;
    const fieldName = String(
      (event as { info?: { fieldName?: string } }).info?.fieldName ?? "",
    );
    const refNormalized = normalizeCalendarYmd(args.referenceDate);
    /**
     * 同一 Lambda に複数ミューテーションがあると、クライアントが空配列 `recentContextLogLines: []`
     * を付ける場合があり、従来の「logDate 空なら月次」判定でフィードバック側に誤る。
     * processStudyLogFeedback には必ず minutes（数値）が来るため、それで区別する。
     */
    const routeMonthly =
      fieldName === "analyzeMonthlyStudyLogs" ||
      (Boolean(refNormalized) && !hasProcessStudyLogFeedbackShape(args));

    if (routeMonthly) {
      const owner = ownerFromAppSyncIdentity(event.identity);
      const goalId = String(args.goalId ?? "");
      const goalTitle = String(args.goalTitle ?? "").trim() || "（無題の目標）";
      const referenceDate = refNormalized;
      if (!goalId) {
        throw new Error("goalId は必須です。");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
        throw new Error("referenceDate は YYYY-MM-DD で指定してください。");
      }
      return executeAnalyzeMonthlyStudyLogs(owner, goalId, goalTitle, referenceDate);
    }

    const owner = ownerFromAppSyncIdentity(event.identity);
    const goalId = String(args.goalId ?? "");
    const goalTitle = String(args.goalTitle ?? "").trim() || "（無題の目標）";
    const recentContextLogLines = asStringArray(args.recentContextLogLines);
    const logDate = normalizeCalendarYmd(args.logDate) || String(args.logDate ?? "").trim();
    const minutes = Number(args.minutes ?? 0);
    const note = String(args.note ?? "");
    const satisfaction = Number(args.satisfaction ?? 0);
    void args.createdAt;

    if (!goalId) {
      throw new Error("goalId は必須です。");
    }
    if (!logDate) {
      throw new Error("logDate は必須です。");
    }

    const payload: LogPayload = {
      goalId,
      logDate,
      minutes,
      note,
      satisfaction,
    };

    await executeIndexLog(owner, { ...payload, goalTitle });
    return executeGenerateFeedback(owner, payload, {
      goalTitle,
      recentContextLogLines,
    });
  }

  const flat = parseEvent(event);
  const action = String(flat.action ?? "");

  const owner = String(flat.owner ?? "");
  const goalId = String(flat.goalId ?? "");
  const goalTitle = String(flat.goalTitle ?? "").trim() || "（無題の目標）";
  const logDate = String(flat.logDate ?? "");
  const minutes = Number(flat.minutes ?? 0);
  const note = String(flat.note ?? "");
  const satisfaction = Number(flat.satisfaction ?? 0);

  if (!owner || !goalId || !logDate) {
    throw new Error("owner・goalId・logDate は必須です。");
  }

  const payload: LogPayload = {
    goalId,
    logDate,
    minutes,
    note,
    satisfaction,
  };

  if (action === "indexLog") {
    await executeIndexLog(owner, { ...payload, goalTitle });
    return {
      ok: true,
      action: "indexLog",
      keyHint: `${encodeURIComponent(owner)}#${encodeURIComponent(goalId)}#${logDate}`,
      indexed: Boolean(VECTOR_INDEX_ARN.trim()),
    };
  }

  if (action === "generateFeedback") {
    const recentContextLogLines = asStringArray(flat.recentContextLogLines);
    const feedback = await executeGenerateFeedback(owner, payload, {
      goalTitle,
      recentContextLogLines,
    });
    return {
      ok: true,
      action: "generateFeedback",
      feedback,
    };
  }

  throw new Error(
    `未知の action です: "${action}"。indexLog または generateFeedback を指定するか、AppSync 経由で呼び出してください。`,
  );
};

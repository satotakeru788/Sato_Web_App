import type { Schema } from "../amplify/data/resource";
import { generateClient } from "aws-amplify/data";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

/** AppSync Data クライアント（画面コンポーネント間で共有） */
export const dataClient = generateClient<Schema>();

/** AppSync owner 認可と同じ値（JWT `sub`） */
export async function ownerPartitionKey() {
  const session = await fetchAuthSession();
  const sub = session.tokens?.idToken?.payload?.sub;
  if (typeof sub === "string" && sub.length > 0) {
    return sub;
  }
  const u = await getCurrentUser();
  return u.userId;
}

/** ownerGoalKey GSI 用（owner に含まれない区切り） */
export function ownerGoalKey(owner: string, goalId: string) {
  return `${owner}|||${goalId}`;
}

export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD 同士の大小（文字列比較で可） */
export function ymdMax(a: string, b: string): string {
  return a >= b ? a : b;
}

function parseLocalYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * AI 参照用の日付リスト（古い→新しい）。
 * endYmd を終端とするカレンダー7日間（endYmd の6日前～endYmd）。目標作成日とは独立。
 */
export function feedbackReferenceDates(endYmd: string): string[] {
  const endOnly = parseLocalYmd(endYmd);
  const weekStart = new Date(
    endOnly.getFullYear(),
    endOnly.getMonth(),
    endOnly.getDate(),
  );
  weekStart.setDate(weekStart.getDate() - 6);
  const out: string[] = [];
  for (
    let cur = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate(),
    );
    cur.getTime() <= endOnly.getTime();
    cur.setDate(cur.getDate() + 1)
  ) {
    out.push(localDateString(cur));
  }
  return out;
}

/**
 * 分析など用：endYmd を**含む**終端として、そこから遡る n 日分の日付（古い→新しい）。
 * 月次分析 Lambda の rollingLastNDaysYmd と同じカレンダー扱い。
 */
export function calendarRollingDaysEndInclusive(endYmd: string, n: number): string[] {
  const endOnly = parseLocalYmd(endYmd);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(
      endOnly.getFullYear(),
      endOnly.getMonth(),
      endOnly.getDate(),
    );
    t.setDate(t.getDate() - i);
    out.push(localDateString(t));
  }
  return out;
}

/** プロンプト用の 1 行（handler の buildDisplayLogLine と揃える） */
export function formatStudyLogContextLine(
  logDate: string,
  minutes: number,
  satisfaction: number,
  note: string,
) {
  return `${logDate} ${minutes}分 満足度${satisfaction} ${note}`;
}

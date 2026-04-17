import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  dataClient as client,
  feedbackReferenceDates,
  formatStudyLogContextLine,
  ownerGoalKey,
  ownerPartitionKey,
  localDateString,
} from "../amplifyData";
import { useGoalContext } from "../context/GoalContext";

async function buildRecentContextLogLines(input: {
  owner: string;
  goalId: string;
  endYmd: string;
}): Promise<string[]> {
  const dates = feedbackReferenceDates(input.endYmd);
  if (dates.length === 0) return [];
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const ogk = ownerGoalKey(input.owner, input.goalId);
  const res = await client.models.StudyLog.listStudyLogByOwnerGoalKeyAndLogDate(
    { ownerGoalKey: ogk, logDate: { between: [start, end] } },
    { limit: 100 },
  );
  if (res.errors?.length) {
    throw new Error(res.errors.map((e) => e.message).join(" "));
  }
  const byDate = new Map<string, (typeof res.data)[number]>();
  for (const row of res.data) {
    if (row.logDate) byDate.set(row.logDate, row);
  }
  return dates.map((d) => {
    const row = byDate.get(d);
    if (!row) return `${d}: （記録なし）`;
    return formatStudyLogContextLine(
      d,
      row.minutes ?? 0,
      row.satisfaction ?? 0,
      row.note ?? "",
    );
  });
}

/**
 * 選択中の目標に紐づく学習ログの入力・保存と AI フィードバック。
 */
export default function StudyLogPage() {
  const { selectedGoal, selectedGoalId } = useGoalContext();
  const [logDate, setLogDate] = useState(localDateString);
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState("");
  const [satisfaction, setSatisfaction] = useState(3);
  const [logCreatedAt, setLogCreatedAt] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackGood, setFeedbackGood] = useState("");
  const [feedbackImprove, setFeedbackImprove] = useState("");
  const [feedbackNext, setFeedbackNext] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const loadLogForDate = useCallback(
    async (date: string) => {
      if (!selectedGoalId || !selectedGoal?.createdAt) {
        setExistingId(null);
        setMinutes(30);
        setNote("");
        setLogCreatedAt(null);
        setSatisfaction(3);
        setFeedbackGood("");
        setFeedbackImprove("");
        setFeedbackNext("");
        return;
      }
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const owner = await ownerPartitionKey();
        const ogk = ownerGoalKey(owner, selectedGoalId);
        const { data, errors } =
          await client.models.StudyLog.listStudyLogByOwnerGoalKeyAndLogDate({
            ownerGoalKey: ogk,
            logDate: { eq: date },
          });
        if (errors?.length) {
          setError(errors.map((e) => e.message).join(" "));
          setExistingId(null);
          setMinutes(30);
          setNote("");
          setLogCreatedAt(null);
          setSatisfaction(3);
          return;
        }
        const row = data[0];
        if (row) {
          setExistingId(row.id);
          setMinutes(row.minutes ?? 0);
          setNote(row.note ?? "");
          setLogCreatedAt(row.createdAt ?? null);
          setSatisfaction(row.satisfaction ?? 3);
        } else {
          setExistingId(null);
          setMinutes(30);
          setNote("");
          setLogCreatedAt(null);
          setSatisfaction(3);
        }

        const { data: fbRows, errors: fbErr } =
          await client.models.StudyFeedback.listStudyFeedbackByOwnerGoalKeyAndLogDate(
            {
              ownerGoalKey: ogk,
              logDate: { eq: date },
            },
          );
        if (fbErr?.length) {
          setFeedbackGood("");
          setFeedbackImprove("");
          setFeedbackNext("");
        } else {
          const fb = fbRows[0];
          if (fb) {
            setFeedbackGood(fb.goodPoints ?? "");
            setFeedbackImprove(fb.improvePoints ?? "");
            setFeedbackNext(fb.nextAction ?? "");
          } else {
            setFeedbackGood("");
            setFeedbackImprove("");
            setFeedbackNext("");
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setExistingId(null);
        setNote("");
        setLogCreatedAt(null);
        setFeedbackGood("");
        setFeedbackImprove("");
        setFeedbackNext("");
      } finally {
        setLoading(false);
      }
    },
    [selectedGoalId, selectedGoal?.createdAt],
  );

  useEffect(() => {
    void loadLogForDate(logDate);
  }, [logDate, loadLogForDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!selectedGoalId || !selectedGoal?.name || !selectedGoal.createdAt) {
      setError("先に「目標の設定」で目標を選んでください。");
      return;
    }

    const trimmed = note.trim();
    if (!trimmed) {
      setError("内容（自由記述）を入力してください。");
      return;
    }
    if (trimmed.length > 200) {
      setError("自由記述は200文字以内にしてください。");
      return;
    }
    if (minutes < 0 || minutes > 24 * 60) {
      setError("実施時間（分）は 0〜1440 の範囲で入力してください。");
      return;
    }
    if (satisfaction < 1 || satisfaction > 5) {
      setError("満足度は 1〜5 を選んでください。");
      return;
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      let studyLogCreatedAtForAi = logCreatedAt ?? nowIso;
      const owner = await ownerPartitionKey();
      const ogk = ownerGoalKey(owner, selectedGoalId);

      if (existingId) {
        const { errors } = await client.models.StudyLog.update({
          id: existingId,
          goalId: selectedGoalId,
          ownerGoalKey: ogk,
          logDate,
          minutes,
          note: trimmed,
          satisfaction,
          createdAt: studyLogCreatedAtForAi,
        });
        if (errors?.length) {
          setError(errors.map((er) => er.message).join(" "));
          return;
        }
        setMessage("保存しました（更新）。");
      } else {
        const { data, errors } = await client.models.StudyLog.create({
          goalId: selectedGoalId,
          ownerGoalKey: ogk,
          logDate,
          minutes,
          note: trimmed,
          satisfaction,
          createdAt: nowIso,
        });
        if (errors?.length) {
          setError(errors.map((er) => er.message).join(" "));
          return;
        }
        if (data?.id) setExistingId(data.id);
        studyLogCreatedAtForAi = data?.createdAt ?? nowIso;
        setLogCreatedAt(studyLogCreatedAtForAi);
        setMessage("保存しました（新規）。");
      }

      setAiBusy(true);
      setFeedbackGood("");
      setFeedbackImprove("");
      setFeedbackNext("");

      /** 窓の終端は保存するログ日（その日までの直近7日を参照） */
      const contextEndYmd = logDate;
      const recentContextLogLines = await buildRecentContextLogLines({
        owner,
        goalId: selectedGoalId,
        endYmd: contextEndYmd,
      });
      /** 保存直後は GSI の読み取りが追いつかないことがあるため、今回保存した日はフォーム値で上書き */
      const refDates = feedbackReferenceDates(contextEndYmd);
      const slot = refDates.indexOf(logDate);
      if (slot >= 0) {
        recentContextLogLines[slot] = formatStudyLogContextLine(
          logDate,
          minutes,
          satisfaction,
          trimmed,
        );
      } else {
        recentContextLogLines.push(
          `（編集中の日）${formatStudyLogContextLine(logDate, minutes, satisfaction, trimmed)}`,
        );
      }

      const aiRes = await client.mutations.processStudyLogFeedback({
        goalId: selectedGoalId,
        goalTitle: selectedGoal.name,
        recentContextLogLines,
        logDate,
        minutes,
        note: trimmed,
        satisfaction,
        createdAt: studyLogCreatedAtForAi,
      });

      if (aiRes.errors?.length) {
        setError(
          (aiRes.errors.map((e) => e.message).join(" ") ||
            "AI フィードバックの生成に失敗しました。") +
            "（ログ自体は保存済みです）",
        );
        return;
      }

      const fb = aiRes.data;
      if (!fb) {
        setError("AI からの応答が空です。（ログは保存済みです）");
        return;
      }

      setFeedbackGood(fb.goodPoints);
      setFeedbackImprove(fb.improvePoints);
      setFeedbackNext(fb.nextAction);

      const { data: existingFbList, errors: listFbErr } =
        await client.models.StudyFeedback.listStudyFeedbackByOwnerGoalKeyAndLogDate(
          {
            ownerGoalKey: ogk,
            logDate: { eq: logDate },
          },
        );
      if (listFbErr?.length) {
        setError(listFbErr.map((e) => e.message).join(" "));
        return;
      }
      const existingFb = existingFbList[0];
      const fbNow = new Date().toISOString();
      if (existingFb?.id) {
        const { errors: upErr } = await client.models.StudyFeedback.update({
          id: existingFb.id,
          goalId: selectedGoalId,
          ownerGoalKey: ogk,
          logDate,
          goodPoints: fb.goodPoints,
          improvePoints: fb.improvePoints,
          nextAction: fb.nextAction,
          createdAt: existingFb.createdAt ?? fbNow,
        });
        if (upErr?.length) {
          setError(upErr.map((e) => e.message).join(" "));
          return;
        }
      } else {
        const { errors: crErr } = await client.models.StudyFeedback.create({
          goalId: selectedGoalId,
          ownerGoalKey: ogk,
          logDate,
          goodPoints: fb.goodPoints,
          improvePoints: fb.improvePoints,
          nextAction: fb.nextAction,
          createdAt: fbNow,
        });
        if (crErr?.length) {
          setError(crErr.map((e) => e.message).join(" "));
          return;
        }
      }

      setMessage((m) =>
        m ? `${m} AIフィードバックを保存しました。` : "AIフィードバックを保存しました。",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setAiBusy(false);
    }
  }

  if (!selectedGoalId || !selectedGoal) {
    return (
      <>
        <h1 className="page-title">今日の行動ログ</h1>
        <p className="page-lead">
          ログを残すには、先に目標を登録してから「この目標で記録する」を選んでください。
        </p>
        <p className="page-lead">
          <Link to="/goals" className="goal-banner-action goal-banner-action--solo">
            目標の設定へ
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">今日の行動ログ</h1>
      <div className="goal-banner" aria-label="選択中の目標">
        <div className="goal-banner-text">
          <span className="goal-banner-label">選択中の目標</span>
          <strong className="goal-banner-name">{selectedGoal.name}</strong>
        </div>
        <Link to="/goals" className="goal-banner-action">
          目標を変更
        </Link>
      </div>

      <form className="study-log-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">日付</span>
          <input
            type="date"
            value={logDate}
            onChange={(ev) => setLogDate(ev.target.value)}
            disabled={loading || saving}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">実施時間（分）</span>
          <input
            type="number"
            min={0}
            max={1440}
            step={1}
            value={minutes}
            onChange={(ev) => setMinutes(Number(ev.target.value))}
            disabled={loading || saving}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">自由記述（200字以内）</span>
          <textarea
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            disabled={loading || saving}
            rows={5}
            maxLength={200}
            placeholder="例：リスニング教材ユニット2、シャドーイング10分"
            required
          />
        </label>

        <fieldset className="field satisfaction-field" disabled={loading || saving}>
          <legend className="field-label">満足度（1〜5）</legend>
          <div className="satisfaction-options">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="radio-pill">
                <input
                  type="radio"
                  name="satisfaction"
                  value={n}
                  checked={satisfaction === n}
                  onChange={() => setSatisfaction(n)}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <div className="form-actions">
          <button type="submit" disabled={loading || saving}>
            {saving
              ? aiBusy
                ? "保存・AI生成中…"
                : "保存中…"
              : existingId
                ? "更新する"
                : "保存する"}
          </button>
        </div>
      </form>

      {(feedbackGood || feedbackImprove || feedbackNext || aiBusy) && (
        <section className="feedback-panel" aria-live="polite">
          <h2 className="feedback-title">AIフィードバック</h2>
          {aiBusy ? (
            <p className="feedback-muted">生成中です…</p>
          ) : (
            <>
              <div className="feedback-block">
                <h3 className="feedback-label">良かった点</h3>
                <p className="feedback-body">{feedbackGood || "—"}</p>
              </div>
              <div className="feedback-block">
                <h3 className="feedback-label">改善点</h3>
                <p className="feedback-body">{feedbackImprove || "—"}</p>
              </div>
              <div className="feedback-block">
                <h3 className="feedback-label">次の一手</h3>
                <p className="feedback-body">{feedbackNext || "—"}</p>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

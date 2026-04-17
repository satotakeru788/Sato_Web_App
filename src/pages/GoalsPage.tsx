import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import {
  dataClient as client,
  ownerGoalKey,
  ownerPartitionKey,
} from "../amplifyData";
import { useGoalContext } from "../context/GoalContext";

/**
 * 目標の登録・一覧。ログ入力の前に目標を作る想定。
 */
export default function GoalsPage() {
  const { goals, loading, error, refreshGoals, setSelectedGoalId, selectedGoalId } =
    useGoalContext();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError("目標の名前を入力してください。");
      return;
    }
    if (trimmed.length > 80) {
      setLocalError("目標名は80文字以内にしてください。");
      return;
    }
    setBusy(true);
    setLocalError(null);
    setMsg(null);
    try {
      const { data, errors } = await client.models.StudyGoal.create({
        name: trimmed,
        createdAt: new Date().toISOString(),
      });
      if (errors?.length) {
        setLocalError(errors.map((er) => er.message).join(" "));
        return;
      }
      setName("");
      setMsg("目標を追加しました。");
      if (data?.id) setSelectedGoalId(data.id);
      await refreshGoals();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function tryDeleteGoal(goalId: string) {
    const owner = await ownerPartitionKey();
    const ogk = ownerGoalKey(owner, goalId);
    const { data, errors } =
      await client.models.StudyLog.listStudyLogByOwnerGoalKeyAndLogDate(
        { ownerGoalKey: ogk },
        { limit: 1 },
      );
    if (errors?.length) {
      setLocalError(errors.map((e) => e.message).join(" "));
      return;
    }
    const hasLogs = data.length > 0;
    const confirmMessage = hasLogs
      ? "この目標には学習ログがあります。削除してもよいですか？"
      : "この目標を削除しますか？";
    if (!window.confirm(confirmMessage)) return;
    setBusy(true);
    setLocalError(null);
    try {
      const { errors: delErr } = await client.models.StudyGoal.delete({ id: goalId });
      if (delErr?.length) {
        setLocalError(delErr.map((e) => e.message).join(" "));
        return;
      }
      if (selectedGoalId === goalId) setSelectedGoalId(null);
      setMsg("目標を削除しました。");
      await refreshGoals();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const showError = localError || error;

  return (
    <>
      <h1 className="page-title">目標の設定</h1>
      <p className="page-lead">
        先に目標を登録し、ログ入力・過去の記録・AI
        フィードバックは目標ごとに分かれます。保存したログ日を終端としたカレンダー7日分の記録を参照してコメントします。
      </p>

      <p className="page-lead">
        <Link to="/" className="nav-link">
          ログ入力へ
        </Link>
        {" · "}
        <Link to="/history" className="nav-link">
          過去の記録へ
        </Link>
      </p>

      {showError ? <p className="form-error">{showError}</p> : null}
      {msg ? <p className="form-success">{msg}</p> : null}

      <form className="study-log-form" onSubmit={onCreate}>
        <label className="field">
          <span className="field-label">新しい目標の名前</span>
          <input
            type="text"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            disabled={busy || loading}
            placeholder="例：英語のリスニング毎日15分"
            maxLength={80}
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy || loading}>
            目標を追加
          </button>
        </div>
      </form>

      <section className="goals-list-section" aria-labelledby="goals-list-heading">
        <h2 id="goals-list-heading" className="feedback-title">
          登録済みの目標
        </h2>
        {loading ? (
          <p className="feedback-muted">読み込み中…</p>
        ) : goals.length === 0 ? (
          <p className="feedback-muted">まだ目標がありません。上のフォームから追加してください。</p>
        ) : (
          <ul className="goals-list">
            {goals.map((g) => (
              <li key={g.id} className="goals-list-item">
                <div className="goals-list-main">
                  <span className="goals-list-name">{g.name}</span>
                  {g.id === selectedGoalId ? (
                    <span className="goals-list-badge">選択中</span>
                  ) : null}
                </div>
                <div className="goals-list-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => g.id && setSelectedGoalId(g.id)}
                  >
                    この目標で記録する
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => g.id && void tryDeleteGoal(g.id)}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

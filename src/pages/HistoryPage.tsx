import { useCallback, useEffect, useMemo, useState } from "react";
import type { Schema } from "../../amplify/data/resource";
import { Link } from "react-router-dom";
import {
  dataClient as client,
  localDateString,
  ownerGoalKey,
  ownerPartitionKey,
} from "../amplifyData";
import { useGoalContext } from "../context/GoalContext";

type StudyLogRow = Schema["StudyLog"]["type"];
type StudyFeedbackRow = Schema["StudyFeedback"]["type"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** ローカル日付キー YYYY-MM-DD */
function toYMD(year: number, monthIndex: number, day: number) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * 月の [start, end] を GSI の logDate between に渡す（文字列比較で日付順と一致）
 */
function monthRange(year: number, monthIndex: number) {
  const start = toYMD(year, monthIndex, 1);
  const end = toYMD(year, monthIndex, daysInMonth(year, monthIndex));
  return { start, end };
}

/** 月曜始まりのカレンダーで、1日が左から何列目か（0=月…6=日） */
function mondayOffsetFirstDay(year: number, monthIndex: number) {
  const wd = new Date(year, monthIndex, 1).getDay();
  return (wd + 6) % 7;
}

/**
 * 過去のログ・フィードバックをカレンダーで俯瞰し、日付クリックで詳細表示。
 * 実施あり（1分以上）はセルを強調。ownerGoalKey + logDate の Query のみ使用。
 */
export default function HistoryPage() {
  const { selectedGoal, selectedGoalId } = useGoalContext();
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const [logByDate, setLogByDate] = useState<Map<string, StudyLogRow>>(new Map());
  const [feedbackByDate, setFeedbackByDate] = useState<
    Map<string, StudyFeedbackRow>
  >(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 選択中の日付キー（YYYY-MM-DD）。カレンダー外の月に切り替えたらクリア */
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const loadMonth = useCallback(
    async (year: number, monthIndex: number) => {
      if (!selectedGoalId) {
        setLogByDate(new Map());
        setFeedbackByDate(new Map());
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const owner = await ownerPartitionKey();
        const ogk = ownerGoalKey(owner, selectedGoalId);
        const { start, end } = monthRange(year, monthIndex);

        const logRes =
          await client.models.StudyLog.listStudyLogByOwnerGoalKeyAndLogDate(
            { ownerGoalKey: ogk, logDate: { between: [start, end] } },
            { limit: 500 },
          );
        if (logRes.errors?.length) {
          setError(logRes.errors.map((e) => e.message).join(" "));
          setLogByDate(new Map());
          setFeedbackByDate(new Map());
          return;
        }

        const fbRes =
          await client.models.StudyFeedback.listStudyFeedbackByOwnerGoalKeyAndLogDate(
            { ownerGoalKey: ogk, logDate: { between: [start, end] } },
            { limit: 500 },
          );
        if (fbRes.errors?.length) {
          setError(fbRes.errors.map((e) => e.message).join(" "));
          setLogByDate(new Map());
          setFeedbackByDate(new Map());
          return;
        }

        const logs = new Map<string, StudyLogRow>();
        for (const row of logRes.data) {
          if (row.logDate) logs.set(row.logDate, row);
        }
        const fbs = new Map<string, StudyFeedbackRow>();
        for (const row of fbRes.data) {
          if (row.logDate) fbs.set(row.logDate, row);
        }
        setLogByDate(logs);
        setFeedbackByDate(fbs);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLogByDate(new Map());
        setFeedbackByDate(new Map());
      } finally {
        setLoading(false);
      }
    },
    [selectedGoalId],
  );

  useEffect(() => {
    if (!selectedGoalId) {
      setLoading(false);
      setLogByDate(new Map());
      setFeedbackByDate(new Map());
      return;
    }
    void loadMonth(viewYear, viewMonth);
  }, [viewYear, viewMonth, loadMonth, selectedGoalId]);

  useEffect(() => {
    setSelectedDate(null);
  }, [viewYear, viewMonth]);

  useEffect(() => {
    setSelectedDate(null);
  }, [selectedGoalId]);

  function goPrevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goThisMonth() {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const calendarCells = useMemo(() => {
    const year = viewYear;
    const monthIndex = viewMonth;
    const dim = daysInMonth(year, monthIndex);
    const lead = mondayOffsetFirstDay(year, monthIndex);
    const cells: { key: string; day: number | null }[] = [];
    for (let i = 0; i < lead; i++) {
      cells.push({ key: `pad-${i}`, day: null });
    }
    for (let d = 1; d <= dim; d++) {
      cells.push({ key: toYMD(year, monthIndex, d), day: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `trail-${cells.length}`, day: null });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const weekdayLabels = ["月", "火", "水", "木", "金", "土", "日"];

  const selectedLog = selectedDate ? logByDate.get(selectedDate) : undefined;
  const selectedFeedback = selectedDate
    ? feedbackByDate.get(selectedDate)
    : undefined;

  const todayKey = localDateString();

  if (!selectedGoalId || !selectedGoal) {
    return (
      <>
        <h1 className="page-title">過去のログとフィードバック</h1>
        <p className="page-lead">
          カレンダーは選択中の目標ごとに表示されます。先に目標を選んでください。
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
      <h1 className="page-title">過去のログとフィードバック</h1>
      <div className="goal-banner" aria-label="表示対象の目標">
        <div className="goal-banner-text">
          <span className="goal-banner-label">表示中の目標</span>
          <strong className="goal-banner-name">{selectedGoal.name}</strong>
        </div>
        <Link to="/goals" className="goal-banner-action">
          目標を変更
        </Link>
      </div>
      <p className="page-lead page-lead--after-banner">
        カレンダーで学習した日を確認し、日付を押すとその日のログと AI
        フィードバックが表示されます。実施時間が 1 分以上の日は色が付きます。
      </p>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="calendar-toolbar">
        <button type="button" className="btn-secondary" onClick={goPrevMonth}>
          ← 前月
        </button>
        <h2 className="calendar-month-title" aria-live="polite">
          {viewYear}年 {viewMonth + 1}月
        </h2>
        <button type="button" className="btn-secondary" onClick={goNextMonth}>
          翌月 →
        </button>
        <button type="button" className="btn-ghost" onClick={goThisMonth}>
          今月
        </button>
      </div>

      {loading ? (
        <p className="feedback-muted">読み込み中…</p>
      ) : (
        <div className="calendar-shell">
          <div className="calendar-weekdays" role="row">
            {weekdayLabels.map((w) => (
              <div key={w} className="calendar-weekday" role="columnheader">
                {w}
              </div>
            ))}
          </div>
          <div className="calendar-grid" role="grid">
            {calendarCells.map((cell) => {
              if (cell.day === null) {
                return (
                  <div key={cell.key} className="calendar-day calendar-day--empty" />
                );
              }
              const dateKey = toYMD(viewYear, viewMonth, cell.day);
              const log = logByDate.get(dateKey);
              const minutes = log?.minutes ?? 0;
              const hasDone = minutes >= 1;
              const isSelected = selectedDate === dateKey;
              const isToday = dateKey === todayKey;

              let dayClass = "calendar-day";
              if (hasDone) dayClass += " calendar-day--done";
              else if (log) dayClass += " calendar-day--logged";
              if (isSelected) dayClass += " calendar-day--selected";
              if (isToday) dayClass += " calendar-day--today";

              return (
                <button
                  key={dateKey}
                  type="button"
                  className={dayClass}
                  onClick={() => setSelectedDate(dateKey)}
                  aria-pressed={isSelected}
                  aria-label={`${dateKey}${hasDone ? " 実施あり" : log ? " ログのみ" : " ログなし"}`}
                >
                  <span className="calendar-day-num">{cell.day}</span>
                  {hasDone ? (
                    <span className="calendar-dot" aria-hidden title="実施あり" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <section className="history-detail" aria-live="polite">
        <h2 className="history-detail-title">
          {selectedDate ? `${selectedDate} の内容` : "日付を選んでください"}
        </h2>
        {!selectedDate ? (
          <p className="feedback-muted">
            上のカレンダーから日付をタップすると詳細が表示されます。
          </p>
        ) : !logByDate.has(selectedDate) ? (
          <p className="feedback-muted">この日は学習ログがありません。</p>
        ) : (
          <div className="history-detail-inner">
            <div className="history-log-section">
              <h3 className="history-fb-heading">学習ログ</h3>
              <dl className="history-meta">
                <div>
                  <dt>実施時間</dt>
                  <dd>{selectedLog?.minutes ?? "—"} 分</dd>
                </div>
                <div>
                  <dt>満足度</dt>
                  <dd>{selectedLog?.satisfaction ?? "—"}</dd>
                </div>
              </dl>
              <div className="history-note">
                <span className="history-note-label">自由記述</span>
                <p className="history-note-body">{selectedLog?.note || "—"}</p>
              </div>
            </div>
            <div className="history-fb-section">
              <h3 className="history-fb-heading">AIフィードバック</h3>
              {selectedFeedback ? (
                <>
                  <div className="feedback-block">
                    <h4 className="feedback-label">良かった点</h4>
                    <p className="feedback-body">
                      {selectedFeedback.goodPoints || "—"}
                    </p>
                  </div>
                  <div className="feedback-block">
                    <h4 className="feedback-label">改善点</h4>
                    <p className="feedback-body">
                      {selectedFeedback.improvePoints || "—"}
                    </p>
                  </div>
                  <div className="feedback-block">
                    <h4 className="feedback-label">次の一手</h4>
                    <p className="feedback-body">
                      {selectedFeedback.nextAction || "—"}
                    </p>
                  </div>
                </>
              ) : (
                <p className="feedback-muted">
                  この日のフィードバックはまだありません。
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

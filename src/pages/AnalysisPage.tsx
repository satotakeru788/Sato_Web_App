import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  calendarRollingDaysEndInclusive,
  dataClient as client,
  localDateString,
  ownerGoalKey,
  ownerPartitionKey,
} from "../amplifyData";
import { useGoalContext } from "../context/GoalContext";

type DailyMinutes = { date: string; minutes: number };

function shortYmdLabel(ymd: string): string {
  const parts = ymd.split("-");
  const mo = parts[1] ?? "";
  const da = parts[2] ?? "";
  if (!mo || !da) return ymd;
  return `${Number(mo)}/${Number(da)}`;
}

async function fetchDailyMinutesSeries(
  goalId: string,
  endYmd: string,
): Promise<DailyMinutes[]> {
  const dates = calendarRollingDaysEndInclusive(endYmd, 30);
  if (dates.length === 0) return [];
  const owner = await ownerPartitionKey();
  const ogk = ownerGoalKey(owner, goalId);
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const res = await client.models.StudyLog.listStudyLogByOwnerGoalKeyAndLogDate(
    { ownerGoalKey: ogk, logDate: { between: [start, end] } },
    { limit: 100 },
  );
  if (res.errors?.length) {
    throw new Error(res.errors.map((e) => e.message).join(" "));
  }
  const byDate = new Map<string, number>();
  for (const row of res.data) {
    const ld = row.logDate;
    if (!ld) continue;
    const m = row.minutes ?? 0;
    byDate.set(ld, (byDate.get(ld) ?? 0) + m);
  }
  return dates.map((d) => ({ date: d, minutes: byDate.get(d) ?? 0 }));
}

function AnalysisMinutesChart({ series }: { series: DailyMinutes[] }) {
  const maxMinutes = Math.max(1, ...series.map((s) => s.minutes));
  const totalMinutes = series.reduce((a, s) => a + s.minutes, 0);

  return (
    <section
      className="analysis-block analysis-chart-section"
      aria-label="直近30日の実施時間の棒グラフ"
    >
      <h2 className="analysis-block-title">直近30日の実施時間</h2>
      <p className="analysis-chart-summary">
        合計 <strong>{totalMinutes}</strong> 分（1日あたりの棒の高さ＝実施時間）
      </p>
      <div className="analysis-chart-scroll">
        <div className="analysis-chart-bars" role="list">
          {series.map(({ date, minutes }) => {
            const pct = maxMinutes > 0 ? (minutes / maxMinutes) * 100 : 0;
            const label = `${date} · ${minutes}分`;
            return (
              <div
                key={date}
                className="analysis-chart-col"
                role="listitem"
                aria-label={label}
              >
                <div className="analysis-chart-bar-wrap" title={label}>
                  <div
                    className={
                      minutes > 0
                        ? "analysis-chart-bar"
                        : "analysis-chart-bar analysis-chart-bar--zero"
                    }
                    style={{ height: minutes > 0 ? `${pct}%` : "4px" }}
                  />
                </div>
                <span className="analysis-chart-x" aria-hidden="true">
                  {shortYmdLabel(date)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="analysis-chart-hint">各棒にカーソルを合わせると日付と分数が表示されます。</p>
    </section>
  );
}

/**
 * タブ表示時に月次分析ミューテーションを実行し、結果を表示する。
 * 直近30日の実施時間は DynamoDB から取得し棒グラフで表示する。
 */
export default function AnalysisPage() {
  const { selectedGoal, selectedGoalId } = useGoalContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [dailySeries, setDailySeries] = useState<DailyMinutes[] | null>(null);
  const [result, setResult] = useState<{
    summary: string;
    goodTrends: string;
    badTrends: string;
    suggestion: string;
  } | null>(null);

  useEffect(() => {
    if (!selectedGoalId || !selectedGoal) {
      setResult(null);
      setError(null);
      setChartError(null);
      setDailySeries(null);
      setLoading(false);
      return;
    }
    const goalId = selectedGoalId;
    const goalTitle = selectedGoal.name;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setChartError(null);
      setResult(null);
      setDailySeries(null);
      const referenceDate = localDateString();
      try {
        const [analysisOutcome, chartOutcome] = await Promise.allSettled([
          client.mutations.analyzeMonthlyStudyLogs({
            goalId,
            goalTitle,
            referenceDate,
          }),
          fetchDailyMinutesSeries(goalId, referenceDate),
        ]);

        if (cancelled) return;

        if (chartOutcome.status === "fulfilled") {
          setDailySeries(chartOutcome.value);
        } else {
          const reason =
            chartOutcome.reason instanceof Error
              ? chartOutcome.reason.message
              : String(chartOutcome.reason);
          setChartError(reason);
          setDailySeries(
            calendarRollingDaysEndInclusive(referenceDate, 30).map((d) => ({
              date: d,
              minutes: 0,
            })),
          );
        }

        if (analysisOutcome.status === "fulfilled") {
          const res = analysisOutcome.value;
          if (res.errors?.length) {
            setError(res.errors.map((e) => e.message).join(" "));
            return;
          }
          if (!res.data) {
            setError("分析結果が空です。");
            return;
          }
          setResult(res.data);
        } else {
          const reason =
            analysisOutcome.reason instanceof Error
              ? analysisOutcome.reason.message
              : String(analysisOutcome.reason);
          setError(reason);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedGoalId, selectedGoal]);

  if (!selectedGoalId || !selectedGoal) {
    return (
      <>
        <h1 className="page-title">分析</h1>
        <p className="page-lead">
          月次分析は選択中の目標ごとに行われます。先に目標を選んでください。
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
      <h1 className="page-title">分析</h1>
      <div className="goal-banner" aria-label="分析対象の目標">
        <div className="goal-banner-text">
          <span className="goal-banner-label">対象の目標</span>
          <strong className="goal-banner-name">{selectedGoal.name}</strong>
        </div>
        <Link to="/goals" className="goal-banner-action">
          目標を変更
        </Link>
      </div>
      <p className="page-lead page-lead--after-banner">
        直近約30日分のログを S3 Vectors（および不足分はデータベース）から集め、AI
        が月次の傾向をまとめます。表示のたびに最新の分析を取得します。
      </p>

      {error ? <p className="form-error">{error}</p> : null}
      {chartError ? (
        <p className="form-error" role="status">
          グラフ用のログ取得に失敗しました: {chartError}
        </p>
      ) : null}
      {loading ? <p className="feedback-muted">分析・グラフを読み込み中です…</p> : null}

      {dailySeries && dailySeries.length > 0 && !loading ? (
        <AnalysisMinutesChart series={dailySeries} />
      ) : null}

      {result && !loading ? (
        <div className="analysis-results">
          <section className="analysis-block">
            <h2 className="analysis-block-title">概要</h2>
            <p className="analysis-block-body">{result.summary || "—"}</p>
          </section>
          <section className="analysis-block">
            <h2 className="analysis-block-title">良い傾向</h2>
            <p className="analysis-block-body">{result.goodTrends || "—"}</p>
          </section>
          <section className="analysis-block">
            <h2 className="analysis-block-title">改善ポイント</h2>
            <p className="analysis-block-body">{result.badTrends || "—"}</p>
          </section>
          <section className="analysis-block">
            <h2 className="analysis-block-title">おすすめ</h2>
            <p className="analysis-block-body">{result.suggestion || "—"}</p>
          </section>
        </div>
      ) : null}
    </>
  );
}

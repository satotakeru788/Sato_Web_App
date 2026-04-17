import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Schema } from "../../amplify/data/resource";
import { dataClient as client, ownerPartitionKey } from "../amplifyData";

export type StudyGoalRow = Schema["StudyGoal"]["type"];

const STORAGE_KEY = "selectedStudyGoalId";

type GoalContextValue = {
  goals: StudyGoalRow[];
  loading: boolean;
  error: string | null;
  selectedGoalId: string | null;
  selectedGoal: StudyGoalRow | null;
  setSelectedGoalId: (id: string | null) => void;
  refreshGoals: () => Promise<void>;
};

const GoalContext = createContext<GoalContextValue | null>(null);

export function GoalProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<StudyGoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGoalId, setSelectedGoalIdState] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
  );

  const refreshGoals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const owner = await ownerPartitionKey();
      const res = await client.models.StudyGoal.listStudyGoalByOwnerAndCreatedAt(
        { owner },
        { sortDirection: "ASC" },
      );
      if (res.errors?.length) {
        setError(res.errors.map((e) => e.message).join(" "));
        setGoals([]);
        return;
      }
      setGoals(res.data.filter((g) => Boolean(g?.id)) as StudyGoalRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshGoals();
  }, [refreshGoals]);

  const setSelectedGoalId = useCallback((id: string | null) => {
    setSelectedGoalIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!selectedGoalId) return;
    if (goals.length === 0) return;
    if (!goals.some((g) => g.id === selectedGoalId)) {
      setSelectedGoalId(null);
    }
  }, [goals, selectedGoalId, setSelectedGoalId]);

  const selectedGoal = useMemo(
    () => goals.find((g) => g.id === selectedGoalId) ?? null,
    [goals, selectedGoalId],
  );

  const value = useMemo<GoalContextValue>(
    () => ({
      goals,
      loading,
      error,
      selectedGoalId,
      selectedGoal,
      setSelectedGoalId,
      refreshGoals,
    }),
    [
      goals,
      loading,
      error,
      selectedGoalId,
      selectedGoal,
      setSelectedGoalId,
      refreshGoals,
    ],
  );

  return <GoalContext.Provider value={value}>{children}</GoalContext.Provider>;
}

export function useGoalContext() {
  const ctx = useContext(GoalContext);
  if (!ctx) {
    throw new Error("useGoalContext は GoalProvider 内で使ってください。");
  }
  return ctx;
}

import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { studyRag } from "../functions/study-rag/resource";

const schema = a.schema({
  /** 学習目標（先に登録し、ログ・履歴・AI は目標単位で分離） */
  StudyGoal: a
    .model({
      owner: a.string(),
      name: a.string().required(),
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("owner")
        .sortKeys(["createdAt"])
        .queryField("listStudyGoalByOwnerAndCreatedAt"),
    ])
    .authorization((allow) => [allow.owner().identityClaim("sub")]),

  StudyLog: a
    .model({
      owner: a.string(),
      goalId: a.string().required(),
      /** `${owner}|||${goalId}` — 目標別の日付レンジ Query 用 */
      ownerGoalKey: a.string().required(),
      logDate: a.string().required(),
      minutes: a.integer().required(),
      note: a.string().required(),
      satisfaction: a.integer().required(),
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("ownerGoalKey")
        .sortKeys(["logDate"])
        .queryField("listStudyLogByOwnerGoalKeyAndLogDate"),
    ])
    .authorization((allow) => [allow.owner().identityClaim("sub")]),

  StudyFeedback: a
    .model({
      owner: a.string(),
      goalId: a.string().required(),
      ownerGoalKey: a.string().required(),
      logDate: a.string().required(),
      goodPoints: a.string().required(),
      improvePoints: a.string().required(),
      nextAction: a.string().required(),
      createdAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("ownerGoalKey")
        .sortKeys(["logDate"])
        .queryField("listStudyFeedbackByOwnerGoalKeyAndLogDate"),
    ])
    .authorization((allow) => [allow.owner().identityClaim("sub")]),

  UserHabitSummary: a
    .model({
      owner: a.string(),
      averageMinutes: a.integer().required(),
      streakDays: a.integer().required(),
      updatedAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("owner").queryField("listUserHabitSummaryByOwner"),
    ])
    .authorization((allow) => [allow.owner().identityClaim("sub")]),

  /**
   * ログ保存後に呼び出し。保存ログ日を終端としたカレンダー7日分のログ行をクライアントが渡し、
   * Lambda は Bedrock で JSON フィードバックを返す（ベクトル類似検索は使わない）。
   */
  processStudyLogFeedback: a
    .mutation()
    .arguments({
      goalId: a.string().required(),
      goalTitle: a.string().required(),
      /** 日付順（古い→新しい）の参照用テキスト。終端日から遡る7日分 */
      recentContextLogLines: a.string().array().required(),
      logDate: a.string().required(),
      minutes: a.integer().required(),
      note: a.string().required(),
      satisfaction: a.integer().required(),
      createdAt: a.string().required(),
    })
    .returns(
      a.customType({
        goodPoints: a.string().required(),
        improvePoints: a.string().required(),
        nextAction: a.string().required(),
      }),
    )
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(studyRag)),

  /** 直近約30日: S3 Vectors のメタデータ中心に集め、DynamoDB で不足分を補完して Bedrock が月次分析 JSON を返す */
  analyzeMonthlyStudyLogs: a
    .mutation()
    .arguments({
      goalId: a.string().required(),
      goalTitle: a.string().required(),
      /** 集計ウィンドウの終端日 YYYY-MM-DD（通常は今日のローカル日付） */
      referenceDate: a.string().required(),
    })
    .returns(
      a.customType({
        summary: a.string().required(),
        goodTrends: a.string().required(),
        badTrends: a.string().required(),
        suggestion: a.string().required(),
      }),
    )
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(studyRag)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});

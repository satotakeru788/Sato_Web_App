import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * 学習ログを S3 Vectors に載せ、類似ログを検索してから Bedrock でフィードバック JSON を返す Lambda。
 *
 * VECTOR_INDEX_ARN:
 * - 手元の `amplify/backend.ts` 経由で dotenv が読めているとき、`.env` に値があればその文字列を使用（サンドボックス等）。
 * - 未設定のときは Amplify のシークレット `VECTOR_INDEX_ARN` を参照（`ampx pipeline-deploy` / Hosting 本番向け）。
 * インデックスのベクトル次元は EMBEDDING_DIMENSIONS（既定 1024）と一致させる必要があります。
 *
 * テキスト生成（Converse）は、Haiku 4.5 など新しめのモデルが「オンデマンドのモデル ID 直指定」非対応のため、
 * Bedrock の推論プロファイル ID を渡す必要があります（東京は `jp.` プレフィックス）。
 * .env の TEXT_MODEL_ID で上書き可能（フル ARN でも可）。
 */
const vectorIndexArnFromEnv = process.env.VECTOR_INDEX_ARN?.trim() ?? "";

export const studyRag = defineFunction({
  name: "study-rag",
  /** AppSync リゾルバ + DynamoDB 参照のため data と同一ネストスタックに置き、data↔function の循環依存を避ける */
  resourceGroupName: "data",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    VECTOR_INDEX_ARN: vectorIndexArnFromEnv
      ? vectorIndexArnFromEnv
      : secret("VECTOR_INDEX_ARN"),
    EMBEDDING_MODEL_ID:
      process.env.EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0",
    TEXT_MODEL_ID:
      process.env.TEXT_MODEL_ID ??
      "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS ?? "1024",
  },
});

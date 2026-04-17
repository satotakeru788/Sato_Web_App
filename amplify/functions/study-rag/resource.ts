import { defineFunction } from "@aws-amplify/backend";

/**
 * 学習ログを S3 Vectors に載せ、類似ログを検索してから Bedrock でフィードバック JSON を返す Lambda。
 *
 * デプロイ後、Lambda の環境変数 VECTOR_INDEX_ARN に
 * S3 Vectors のインデックス ARN（コンソールまたは CLI で作成）を設定してください。
 * インデックスのベクトル次元は EMBEDDING_DIMENSIONS（既定 1024）と一致させる必要があります。
 *
 * テキスト生成（Converse）は、Haiku 4.5 など新しめのモデルが「オンデマンドのモデル ID 直指定」非対応のため、
 * Bedrock の推論プロファイル ID を渡す必要があります（東京は `jp.` プレフィックス）。
 * .env の TEXT_MODEL_ID で上書き可能（フル ARN でも可）。
 */
export const studyRag = defineFunction({
  name: "study-rag",
  /** AppSync リゾルバ + DynamoDB 参照のため data と同一ネストスタックに置き、data↔function の循環依存を避ける */
  resourceGroupName: "data",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 512,
  environment: {
    // プロジェクト直下の .env に VECTOR_INDEX_ARN=arn:aws:... を書き、ampx を再実行（amplify/load-env.ts 参照）
    VECTOR_INDEX_ARN: process.env.VECTOR_INDEX_ARN ?? "",
    EMBEDDING_MODEL_ID:
      process.env.EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0",
    TEXT_MODEL_ID:
      process.env.TEXT_MODEL_ID ??
      "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS ?? "1024",
  },
});

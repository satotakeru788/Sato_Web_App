# 本番（Amplify Hosting）と手元で月次分析の挙動を揃える

月次分析は Lambda が `VECTOR_INDEX_ARN` を参照します。  
CI（`npx ampx pipeline-deploy`）では **リポジトリに `.env` が無い**ため、次のどちらかが必要です。

## 推奨: Amplify のシークレット `VECTOR_INDEX_ARN`

1. [AWS Amplify コンソール](https://console.aws.amazon.com/amplify/) で対象アプリを開く。
2. **Hosting**（または Gen 2 の **Secrets / シークレット**）で、ブランチ（例: `main`）向けにシークレットを追加する。
3. 名前: **`VECTOR_INDEX_ARN`**（コードの `secret("VECTOR_INDEX_ARN")` と一致させる）  
   値: S3 Vectors の **インデックス ARN**（Lambda と同じリージョン）。
4. バックエンドを再デプロイする（`main` にマージしてパイプラインが走る、または手動で `ampx pipeline-deploy`）。

公式: [Secrets and environment vars (Gen 2)](https://docs.amplify.aws/react/deploy-and-host/fullstack-branching/secrets-and-vars/)

## 手元サンドボックス（`.env` を使う場合）

`amplify/backend.ts` が先に `load-env` で `.env` を読み込むため、**`VECTOR_INDEX_ARN` を `.env` に書いて `npx ampx sandbox` を実行**すると、その値が Lambda 環境変数に埋め込まれます（シークレットではなく平文の環境変数として）。

`.env` を使わない場合は:

```bash
npx ampx sandbox secret set VECTOR_INDEX_ARN
```

プロンプトに従い、同じインデックス ARN を登録します。

## フロントのエンドポイント

`amplify_outputs.json` が指す **GraphQL エンドポイント**が、サンドボックス用と本番ブランチ用で異なれば、**別の Lambda** に接続しています。  
挙動を揃えるには、**同じバックエンドを指す `amplify_outputs` でビルドしたフロント**と、**そのバックエンドの Lambda に `VECTOR_INDEX_ARN`（.env またはシークレット）**の両方を揃えてください。

/**
 * ampx sandbox / デプロイ時に先に実行され、プロジェクト直下の .env を読み込みます。
 * VECTOR_INDEX_ARN などはここで process.env に載る → defineFunction の environment に反映されます。
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

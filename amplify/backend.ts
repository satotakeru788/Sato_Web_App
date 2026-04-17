import "./load-env";
import { defineBackend } from "@aws-amplify/backend";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { studyRag } from "./functions/study-rag/resource";

const backend = defineBackend({
  auth,
  data,
  studyRag,
});

// Bedrock: 埋め込み（InvokeModel）と会話生成（Converse も InvokeModel 権限で許可）
backend.studyRag.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    resources: ["*"],
  }),
);

// S3 Vectors: 書き込み + 月次分析での GetVectors
backend.studyRag.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3vectors:PutVectors", "s3vectors:GetVectors"],
    resources: ["*"],
  }),
);

const studyLogTableRef = (backend.data.resources as { tables?: Record<string, ITable> })
  .tables?.["StudyLog"];
if (!studyLogTableRef) {
  throw new Error("backend.data.resources.tables.StudyLog is undefined; cannot grant study-rag DynamoDB access.");
}
const studyRagLambda = backend.studyRag.resources.lambda as LambdaFunction;

/** 月次分析の Query 用 GSI。fromTableAttributes + grantReadData では GSI ARN が IAM に乗らない環境があるため明示する */
const STUDY_LOG_GSI = "studyLogsByOwnerGoalKeyAndLogDate";
const studyLogTableArn = studyLogTableRef.tableArn;
const studyLogGsiArn = `${studyLogTableArn}/index/${STUDY_LOG_GSI}`;

studyRagLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:ConditionCheckItem",
    ],
    resources: [studyLogTableArn, studyLogGsiArn],
  }),
);
studyRagLambda.addEnvironment("STUDY_LOG_TABLE_NAME", studyLogTableRef.tableName);
studyRagLambda.addEnvironment("STUDY_LOG_GSI_NAME", STUDY_LOG_GSI);

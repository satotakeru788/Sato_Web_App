import "./load-env";
import { defineBackend } from "@aws-amplify/backend";
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
backend.studyRag.resources.lambda.addToRolePolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    resources: ["*"],
}));
// S3 Vectors: 書き込み + 月次分析での GetVectors
backend.studyRag.resources.lambda.addToRolePolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3vectors:PutVectors", "s3vectors:GetVectors"],
    resources: ["*"],
}));
const studyLogTable = backend.data.resources
    .tables?.["StudyLog"];
if (studyLogTable) {
    const studyRagLambda = backend.studyRag.resources.lambda;
    studyLogTable.grantReadData(studyRagLambda);
    studyRagLambda.addEnvironment("STUDY_LOG_TABLE_NAME", studyLogTable.tableName);
    studyRagLambda.addEnvironment("STUDY_LOG_GSI_NAME", "studyLogsByOwnerGoalKeyAndLogDate");
}

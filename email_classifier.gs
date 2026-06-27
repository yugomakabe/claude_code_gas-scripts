/**
 * email_classifier.gs
 * Gmailの「要処理」ラベルメールをClaude APIで分類し、スプレッドシートとSlackに通知する
 */

// スクリプトプロパティのキー名
const PROP_CLAUDE_API_KEY = 'CLAUDE_API_KEY';
const PROP_SLACK_WEBHOOK_URL = 'SLACK_WEBHOOK_URL';

// Gmailラベル名
const LABEL_PENDING = '要処理';
const LABEL_DONE = '処理済み';

// スプレッドシートシート名
const SHEET_MAIL_LOG = 'メールログ';
const SHEET_ERROR_LOG = 'エラーログ';

// Claude API設定
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_API_VERSION = '2023-06-01';

/**
 * メイン処理：「要処理」ラベルの未読メールを分類・記録・通知する
 */
function classifyEmails() {
  const props = PropertiesService.getScriptProperties();
  const claudeApiKey = props.getProperty(PROP_CLAUDE_API_KEY);
  const slackWebhookUrl = props.getProperty(PROP_SLACK_WEBHOOK_URL);

  if (!claudeApiKey || !slackWebhookUrl) {
    throw new Error('スクリプトプロパティに CLAUDE_API_KEY と SLACK_WEBHOOK_URL を設定してください');
  }

  // 「要処理」ラベルの取得
  const pendingLabel = GmailApp.getUserLabelByName(LABEL_PENDING);
  if (!pendingLabel) {
    Logger.log(`ラベル「${LABEL_PENDING}」が見つかりません`);
    return;
  }

  // 「処理済み」ラベルが存在しない場合は作成する
  let doneLabel = GmailApp.getUserLabelByName(LABEL_DONE);
  if (!doneLabel) {
    doneLabel = GmailApp.createLabel(LABEL_DONE);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mailLogSheet = getOrCreateSheet(ss, SHEET_MAIL_LOG);
  const errorLogSheet = getOrCreateSheet(ss, SHEET_ERROR_LOG);

  // ヘッダーが未設定の場合は書き込む
  ensureMailLogHeader(mailLogSheet);
  ensureErrorLogHeader(errorLogSheet);

  // 「要処理」ラベルのスレッドを取得して未読メールを処理する
  const threads = pendingLabel.getThreads();
  let processedCount = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();

    for (const message of messages) {
      // 既読メールはスキップする
      if (!message.isUnread()) continue;

      try {
        processMessage(message, thread, claudeApiKey, slackWebhookUrl, mailLogSheet, doneLabel, pendingLabel);
        processedCount++;
      } catch (e) {
        logError(errorLogSheet, message, e);
      }
    }
  }

  Logger.log(`処理完了：${processedCount}件のメールを分類しました`);
}

/**
 * 1件のメールを分類・記録・通知し、ラベルを付け替える
 *
 * @param {GmailMessage} message - 処理対象メール
 * @param {GmailThread} thread - メールのスレッド
 * @param {string} claudeApiKey - Claude APIキー
 * @param {string} slackWebhookUrl - Slack Webhook URL
 * @param {Sheet} mailLogSheet - 記録先シート
 * @param {GmailLabel} doneLabel - 「処理済み」ラベル
 * @param {GmailLabel} pendingLabel - 「要処理」ラベル
 */
function processMessage(message, thread, claudeApiKey, slackWebhookUrl, mailLogSheet, doneLabel, pendingLabel) {
  const receivedAt = message.getDate();
  const sender = message.getFrom();
  const subject = message.getSubject();
  const body = message.getPlainBody();

  // Claude APIでメールを分類・要約する
  const { category, summary } = classifyWithClaude(claudeApiKey, subject, body);

  // スプレッドシートに記録する（受信日時・送信者・件名・分類・要約）
  mailLogSheet.appendRow([
    Utilities.formatDate(receivedAt, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss'),
    sender,
    subject,
    category,
    summary,
  ]);

  // Slackに通知する
  notifySlack(slackWebhookUrl, subject, category, summary, sender);

  // 「処理済み」ラベルを付与し「要処理」ラベルを外す
  thread.addLabel(doneLabel);
  thread.removeLabel(pendingLabel);

  // 既読にする
  message.markRead();

  Logger.log(`処理済み: ${subject} → ${category}`);
}

/**
 * Claude APIにメール内容を送信して分類と要約を取得する
 *
 * @param {string} apiKey - Claude APIキー
 * @param {string} subject - 件名
 * @param {string} body - 本文
 * @returns {{category: string, summary: string}} 分類結果と要約
 */
function classifyWithClaude(apiKey, subject, body) {
  const prompt = `以下のメールを分析し、分類と要約を返してください。

件名: ${subject}

本文:
${body.slice(0, 2000)}

---
必ず以下のJSON形式のみで返答してください（他のテキストを含めないこと）：
{
  "category": "クレーム" または "質問" または "注文" または "その他",
  "summary": "メール内容の要約（100文字以内）"
}`;

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 256,
    messages: [
      { role: 'user', content: prompt },
    ],
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode !== 200) {
    throw new Error(`Claude API エラー (HTTP ${statusCode}): ${responseText}`);
  }

  const responseJson = JSON.parse(responseText);
  const content = responseJson.content?.[0]?.text ?? '';

  // JSONブロックを抽出してパースする
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude APIのレスポンスをパースできませんでした: ${content}`);
  }

  const result = JSON.parse(jsonMatch[0]);
  return {
    category: result.category ?? 'その他',
    summary: result.summary ?? '',
  };
}

/**
 * Slack Incoming Webhookで担当者に通知する
 *
 * @param {string} webhookUrl - Slack Webhook URL
 * @param {string} subject - 件名
 * @param {string} category - 分類
 * @param {string} summary - 要約
 * @param {string} sender - 送信者
 */
function notifySlack(webhookUrl, subject, category, summary, sender) {
  const text = `📧 *新着メール通知*\n` +
    `*件名：* ${subject}\n` +
    `*送信者：* ${sender}\n` +
    `*分類：* ${category}\n` +
    `*要約：* ${summary}`;

  const payload = { text };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(webhookUrl, options);
  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(`Slack通知エラー (HTTP ${statusCode}): ${response.getContentText()}`);
  }
}

/**
 * エラー内容を「エラーログ」シートに記録する
 *
 * @param {Sheet} sheet - エラーログシート
 * @param {GmailMessage} message - 処理対象メール
 * @param {Error} error - 発生したエラー
 */
function logError(sheet, message, error) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow([
    now,
    message.getSubject(),
    message.getFrom(),
    error.message,
  ]);
  Logger.log(`エラー記録: ${message.getSubject()} - ${error.message}`);
}

/**
 * 指定名のシートを取得し、存在しない場合は作成して返す
 *
 * @param {Spreadsheet} ss - スプレッドシート
 * @param {string} sheetName - シート名
 * @returns {Sheet} シート
 */
function getOrCreateSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * メールログシートにヘッダーがなければ書き込む
 *
 * @param {Sheet} sheet - メールログシート
 */
function ensureMailLogHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['受信日時', '送信者', '件名', '分類', '要約']);
  }
}

/**
 * エラーログシートにヘッダーがなければ書き込む
 *
 * @param {Sheet} sheet - エラーログシート
 */
function ensureErrorLogHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['発生日時', '件名', '送信者', 'エラー内容']);
  }
}

/**
 * 5分おきに classifyEmails を自動実行するトリガーを設定する
 * 既存の同名トリガーは重複しないよう削除してから登録する
 */
function setIntervalTrigger() {
  const functionName = 'classifyEmails';

  // 既存の classifyEmails トリガーを削除する
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === functionName)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // 5分おきのトリガーを新規登録する
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log(`トリガーを設定しました：5分おきに ${functionName} を実行`);
}

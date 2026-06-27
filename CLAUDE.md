# GAS業務自動化スクリプト

Google Apps Script (GAS) を使った業務自動化プログラムの学習・開発リポジトリです。

## プロジェクト概要

Googleスプレッドシートと連携した業務自動化スクリプト集です。
Claude API・Slack Incoming Webhookを活用したメール分類自動化と、売上データの月次集計ダッシュボードが含まれます。

## ディレクトリ構成

```
gas-scripts/
├── email_classifier.gs    # Gmailメール分類・通知スクリプト
├── summary_dashboard.gs   # 売上データ月次集計・グラフ生成スクリプト
├── CLAUDE.md              # このファイル（Claude Code向けガイド）
└── README.md              # プロジェクト概要・セットアップ手順
```

## スクリプト概要

### email_classifier.gs

- 「要処理」ラベルの未読Gmailを5分おきに取得
- Claude API（claude-haiku-4-5）でカテゴリ分類（クレーム／質問／注文／その他）と100文字要約を生成
- スプレッドシートの「メールログ」シートに記録
- Slack Incoming Webhookで担当者に通知
- ラベルを「要処理」→「処理済み」に付け替えて既読にする
- エラーは「エラーログ」シートに記録

### summary_dashboard.gs

- スプレッドシートの「売上データ」シートから月次集計を行う
- 「月次サマリー」シートに合計売上・件数を書き込む
- 月次売上推移の棒グラフを自動更新
- 毎朝9時に自動実行するトリガーを設定可能

## 開発環境

- Google Apps Script（ブラウザ上のスクリプトエディタ）
- clasp（Command Line Apps Script Projects）※必要に応じて

## スクリプトプロパティ（email_classifier.gs）

GASのスクリプトエディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を設定してください。

| キー | 値 |
|------|-----|
| `CLAUDE_API_KEY` | Anthropic APIキー |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

## トリガー設定

各スクリプトのトリガー設定関数を一度手動実行してください。

- `setIntervalTrigger()` — 5分おきに `classifyEmails()` を実行
- `setDailyTrigger()` — 毎朝9時に `runDashboard()` を実行

## 注意事項

- `email_classifier.gs` はGmail・外部URLへのアクセス権限が必要です
- APIキーはスクリプトプロパティで管理し、コードに直接記述しないでください
- GASはブラウザ環境のため、Anthropic公式SDKは使用できません。`UrlFetchApp`で直接HTTP呼び出しを行っています

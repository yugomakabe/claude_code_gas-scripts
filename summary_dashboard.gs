/**
 * summary_dashboard.gs
 * 売上データを月次集計してサマリーシートに書き込み、棒グラフを生成する
 */

/**
 * メイン処理：売上データを集計してサマリーを更新し、グラフを描画する
 */
function runDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('売上データ');
  const summarySheet = ss.getSheetByName('月次サマリー');

  if (!dataSheet) {
    throw new Error('「売上データ」シートが見つかりません');
  }
  if (!summarySheet) {
    throw new Error('「月次サマリー」シートが見つかりません');
  }

  // 売上データを取得（ヘッダー行を除く2行目以降）
  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('売上データが存在しません');
    return;
  }
  const rawData = dataSheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // 月ごとに合計金額と件数を集計する
  const monthlyMap = {};
  rawData.forEach(row => {
    const dateValue = row[0];
    const amount = row[3];

    // 日付が空または金額が数値でない行はスキップ
    if (!dateValue || typeof amount !== 'number') return;

    const date = new Date(dateValue);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}年${month}月`;

    if (!monthlyMap[key]) {
      monthlyMap[key] = { total: 0, count: 0, sortKey: year * 100 + month };
    }
    monthlyMap[key].total += amount;
    monthlyMap[key].count += 1;
  });

  // 月を昇順に並べ替える
  const sortedMonths = Object.keys(monthlyMap).sort(
    (a, b) => monthlyMap[a].sortKey - monthlyMap[b].sortKey
  );

  // サマリーシートをクリアしてヘッダーを書き込む
  summarySheet.clearContents();
  summarySheet.getRange(1, 1, 1, 3).setValues([['月', '合計売上', '件数']]);

  // 集計結果を書き込む
  const summaryData = sortedMonths.map(month => [
    month,
    monthlyMap[month].total,
    monthlyMap[month].count,
  ]);
  if (summaryData.length > 0) {
    summarySheet.getRange(2, 1, summaryData.length, 3).setValues(summaryData);
  }

  Logger.log(`集計完了：${summaryData.length}ヶ月分のデータを書き込みました`);

  // 棒グラフを更新する
  updateChart(ss, summarySheet, summaryData.length);
}

/**
 * 月次サマリーシートの合計売上を棒グラフで描画する
 * 既存のグラフは削除してから新規作成する
 *
 * @param {Spreadsheet} ss - 対象スプレッドシート
 * @param {Sheet} summarySheet - 月次サマリーシート
 * @param {number} dataRowCount - データ行数（ヘッダーを除く）
 */
function updateChart(ss, summarySheet, dataRowCount) {
  // 既存のグラフをすべて削除する
  const existingCharts = summarySheet.getCharts();
  existingCharts.forEach(chart => summarySheet.removeChart(chart));

  if (dataRowCount === 0) {
    Logger.log('グラフ描画をスキップ：データがありません');
    return;
  }

  // グラフのデータ範囲（月ラベルと合計売上列）
  const labelRange = summarySheet.getRange(1, 1, dataRowCount + 1, 1);
  const valueRange = summarySheet.getRange(1, 2, dataRowCount + 1, 1);

  const chart = summarySheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(labelRange)
    .addRange(valueRange)
    .setOption('title', '月次売上推移')
    .setOption('hAxis.title', '月')
    .setOption('vAxis.title', '合計売上（円）')
    .setOption('legend', { position: 'none' })
    .setPosition(2, 5, 0, 0)  // E2セルを起点に配置
    .build();

  summarySheet.insertChart(chart);
  Logger.log('棒グラフを更新しました');
}

/**
 * 毎朝9時に runDashboard を自動実行するトリガーを設定する
 * 既存の同名トリガーは重複しないよう削除してから登録する
 */
function setDailyTrigger() {
  const functionName = 'runDashboard';

  // 既存の runDashboard トリガーを削除する
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === functionName)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // 毎朝9時のトリガーを新規登録する
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log(`トリガーを設定しました：毎朝9時に ${functionName} を実行`);
}

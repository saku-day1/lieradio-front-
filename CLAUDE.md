# lieradio-front- プロジェクト設定

## コミット・プッシュのルール

- 作業完了後のコミット・プッシュは、**mainブランチへのプッシュを除き**、ユーザーの確認なしで自動的に行う
- mainへのプッシュは事前にユーザーに確認を取る（ただし **CLAUDE.md の変更のみ**の場合は確認不要）
- mainにpushする際はCLAUDE.mdの変更以外を含めない

---

## プロジェクト概要

Love Live! Superstar!! のラジオ番組「リエラジ」の放送回を検索・閲覧するフロントエンドサイト。
Vercel にホストされた静的 HTML + Vanilla JS (ES Modules) + CSS のシングルページアプリ。

---

## ファイル構成

```
/
├── index.html               # SPAのエントリ。すべてのUIがここに定義される
├── style.css                # グローバルスタイル
├── vercel.json              # Vercel設定。毎日0時にepisodes-refreshをCronで実行
│
├── api/                     # Vercel Serverless Functions
│   ├── episodes.js          # YouTube API→エピソード取得。Upstash Redisにキャッシュ
│   ├── episodes-refresh.js  # Cronからキャッシュを強制更新するエンドポイント
│   └── absence-names.js     # 説明文から欠席者名を抽出するユーティリティ
│
├── data/
│   ├── episodes.json        # API失敗時のフォールバック用エピソードデータ
│   └── episodeMeta.json     # Excelから手動インポートしたメタ情報（コーナー・タグ・誕生日等）
│
├── js/
│   ├── main.js              # エントリポイント。AppControllerを生成してinit()するだけ
│   ├── constants.js         # キャスト・ユニット定数（PRIORITY_CAST_FILTERS / UNIT_FILTERS / CAST_COLOR_MAP）
│   ├── controller/
│   │   └── AppController.js # フィルタ状態管理・DOMイベント処理・ModelとViewの橋渡し
│   ├── model/
│   │   ├── EpisodeRepository.js # データ取得・フィルタ・ソート・ランキング集計
│   │   ├── episodeSearch.js     # ファセット検索（コーナー/楽曲/ライブ感想/イベント/アニメ感想/誕生日/公開録音/出来事）
│   │   ├── facetCatalog.js      # 全エピソードからファセット選択肢を生成
│   │   └── UserPreferences.js  # お気に入り・視聴済みのlocalStorage読み書き
│   └── view/
│       ├── EpisodeListView.js   # エピソードリストのDOM描画
│       └── RankingView.js       # 出演者ランキングセクションの描画
│
│   ※ UserPreferences.js はお気に入り・視聴済み・メモのlocalStorage読み書きを担当
│
└── scripts/                 # 開発用Node.jsスクリプト（npmから実行）
    ├── dump-excel.mjs           # npm run dump-excel: Excelの内容をダンプ確認
    ├── import-episode-meta.mjs  # npm run import-episode-meta: ExcelからepisodeMeta.jsonを生成
    └── verify-absence.mjs       # npm run verify-absence: 欠席情報の検証
```

---

## アーキテクチャの要点

### データフロー
1. フロント起動 → `/api/episodes` を fetch
2. サーバーレス側: YouTube Playlist API → 出演者を説明文からパース → Upstash Redis にキャッシュ
3. API失敗時は `data/episodes.json` にフォールバック
4. 取得後、`data/episodeMeta.json` の手動メタ（コーナー・タグ等）を `broadcastNumber` でマージ

### フィルタの種類
- **キャスト単体**（クイックフィルタボタン）
- **キャストAND**（最大5名、全員出演回を抽出）
- **ユニット**（UNIT_FILTERSに定義されたメンバー全員が出演する回）
- **お気に入り / 視聴済み / 未視聴 / その他動画（耐久・総集編）**
- **ファセット検索（詳細検索パネル）**: コーナー・楽曲・ライブ感想・イベント感想・アニメ感想・誕生日・公開録音・出来事

### キャスト定数（constants.js）
- `PRIORITY_CAST_FILTERS`: クイックフィルタに表示する11名のLiella!メンバー（色付き）
- `UNIT_FILTERS`: クーカー・トマカノーテ・CatChu!・KALEIDOSCORE・5yncri5e!・チーム別・ゆいさく・Sunny Passion・虹ヶ咲など
- `CAST_COLOR_MAP`: メンバー名→バッジ色のマップ

### ページネーション
50件/ページ。フィルタ変更でページ1にリセット。

### episodeMeta.json の更新手順
`リエラジ.xlsx` を編集 → `npm run import-episode-meta` で `data/episodeMeta.json` を再生成 → コミット

---

## 責務分離ルール

### 各モジュールの責務

| モジュール | 責務 | やってはいけないこと |
|---|---|---|
| `AppController.js` | フィルタ状態管理・DOMイベント登録・ModelとViewの橋渡し | DOM直接描画（Viewに委譲）・データ取得・localStorage直接操作 |
| `EpisodeListView.js` | エピソードリストのDOM描画・リスト内イベント管理 | 状態の永続化・フィルタロジック・AppControllerへの直接参照 |
| `RankingView.js` | ランキングセクションのDOM描画 | 状態管理・データ計算 |
| `EpisodeRepository.js` | エピソードデータ取得・フィルタ・ソート・集計 | DOM操作・localStorage操作 |
| `UserPreferences.js` | お気に入り・視聴済み・メモのlocalStorage読み書き | DOM操作・データフィルタリング |
| `episodeSearch.js` | ファセット検索ロジック | 状態管理・DOM操作 |
| `facetCatalog.js` | ファセット選択肢の生成 | 状態管理・DOM操作 |

### View → Controller のイベント通知ルール
- ViewからControllerへの通知は**コールバック関数**で行う（例: `onFavToggle`, `onMemoSave`）
- Viewはコールバックを呼ぶだけで、AppControllerの状態や他モジュールを直接触らない
- コールバック後に全体の再描画が必要な場合 → Controllerが `this.render()` を呼ぶ
- コールバック後にDOM部分更新で済む場合（例: メモ保存のプレビュー更新）→ View内で完結させてよい
- 新しいユーザー操作を追加するときは上記パターンに従うこと

---

## UI 実装方針

- **スマートフォン向けユーザーを主対象**として表示を最適化する
- レイアウト・フォントサイズ・タップターゲット・余白はモバイルファーストで設計する
- PC での表示も破綻しない範囲で、スマホでの使いやすさを優先する

---

## 環境変数（Vercel）

| 変数名 | 用途 |
|--------|------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 キー |
| `YOUTUBE_PLAYLIST_ID` | 取得対象のプレイリストID |
| `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` | Upstash Redis URL |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis トークン |
| `CRON_SECRET` | episodes-refresh の認証トークン |
| `ALLOWED_ORIGIN` | CORSで許可するオリジン |

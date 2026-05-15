# lieradio-front- プロジェクト設定

## コミット・プッシュのルール

- 作業完了後のコミット・プッシュは、**mainブランチへのプッシュを除き**、ユーザーの確認なしで自動的に行う
- mainへのプッシュは事前にユーザーに確認を取る（ただし **CLAUDE.md の変更のみ**の場合は確認不要）
- mainにpushする際はCLAUDE.mdの変更以外を含めない

---

## mainマージ前のセキュリティ・法的チェック

mainへのマージ前に、以下の観点で変更差分を確認する。**アウトと判断したら必ずユーザーに報告してからマージする。**

### セキュリティ
- **シークレットのハードコード禁止**: APIキー・トークン・パスワードがコードや `data/` に含まれていないか
- **XSS**: `innerHTML` / `insertAdjacentHTML` 等にユーザー入力・外部データを直接渡していないか（`textContent` やサニタイズを使うこと）
- **サーバーレス関数の認証**: 新しい `/api/*` エンドポイントに認証・オリジンチェックが漏れていないか
- **レートリミットの実効性**: インメモリ状態に頼った制御を追加していないか（Vercelは複数インスタンス起動のためインメモリ状態は無効。カウンターはRedisで持つこと）

### 法的
- **コンテンツのホスティング禁止**: 動画・音声・画像など著作物のファイルを `data/` 等にコミットしていないか（YouTubeへのリンクは可）
- **YouTube API キャッシュ上限**: 新たなキャッシュ実装を追加する場合、TTLが30日以内か（YouTube API ToS 制限）
- **個人情報の新規収集禁止**: サーバー側でユーザーの個人情報（メール・位置情報等）を収集・保存する実装を追加していないか

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
4. 取得後、`data/episodeMeta.json` の手動メタ（コーナー・タグ等）を **`videoId` で完全一致結合**してマージ

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

## データ結合ポリシー（YouTube動画データ ↔ episodeMeta.json）

YouTube API動画データと、Excel管理の詳細メタデータを結合する際は、必ず **`videoId` を主キー**として扱うこと。

### 禁止事項
以下を結合キーとして使用してはならない。

- 動画タイトル
- 第○回表記・`broadcastNumber`
- 公開日
- 配列順
- 部分一致・あいまい一致・推測補完

公開録音・特別回・総集編など通常の第○回形式ではない動画が存在するため、推測結合は誤ったコーナー・リクエスト曲・詳細情報の紐づけ事故を引き起こす。

### 正しい動作
- `videoId` が完全一致した場合のみ詳細情報を結合する
- 詳細情報が未登録の場合は空データとして扱う
- 不明なデータを推測で補完しない
- 間違った情報を表示するくらいなら空欄を優先する

### ログ・検証（警告またはエラーとして扱うこと）
- Excel側に存在するがYouTube側に存在しない `videoId`
- 重複する `videoId`
- `videoId` が未設定の詳細データ

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
- **リクエスト曲（lunchTimeRequestSong）はエピソードカードにインライン表示しない**。ラジオを聴く前にかかった曲を知りたくない人への配慮のため、「詳細」を開いた中にのみ表示する仕様。

---

## Google Sheets リアルタイム反映システム

### 概要
スマホから即時反映できるよう、`episodeMeta.json`（Excel管理）に加えて Google Sheets からライブ取得する仕組みを実装済み。

### ファイル構成への追加（上記ファイル構成に未記載）
```
api/episode-meta.js   # Google Sheets → タグ処理 → Redis キャッシュ → JSON 返却
.github/workflows/refresh-meta.yml  # 手動 workflow_dispatch でキャッシュ即時更新
```

### データフロー（メタ情報）
1. ユーザーが Google Sheets に YouTube URL・コーナー・楽曲などを記入
2. GitHub Actions（workflow_dispatch）で `/api/episode-meta?refresh=1` を叩く
3. `episode-meta.js` が Sheets API から全行取得 → `processRows` で処理 → Redis に書き込む（TTL: 1時間）
4. フロント側の `fetchEpisodeManualMetaOnce` が `/api/episode-meta`（Redis） と `data/episodeMeta.json`（静的ファイル）を **並列取得して videoId でマージ**
   - Sheets（API）データが JSON データより優先される
5. `mergeManualMetaIntoEpisodes` で videoId 完全一致によりエピソードに `manualMeta` を付与

### Google Sheet の想定列構造
| A | B | C | D | E | F〜H | I | J | K〜L | M | N |
|---|---|---|---|---|------|---|---|------|---|---|
| videoId | 回 | コーナー1 | コーナー2 | リクエスト曲 | 備考（誕生日・事件等） | 出来事 | 公開録音 | ライブ感想 | イベント感想 | アニメ感想 |

- `colNum` = "回" 列のインデックス、`o = colNum - 1` を起点に相対オフセットで読む
- `videoId` 列のヘッダー名は `"videoId"` でなければ列が認識されない

### Vercel 環境変数（追加分）
| 変数名 | 用途 |
|--------|------|
| `GOOGLE_SHEETS_API_KEY` | Google Sheets API キー |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | スプレッドシート ID |
| `GOOGLE_SHEETS_SHEET_GID` | シート GID（省略時は最初のシート） |
| `EPISODE_META_CACHE_KEY` | Redis キャッシュキー（デフォルト: `episode_meta_cache_v1`） |
| `EPISODE_META_CACHE_TTL_SEC` | Redis TTL 秒数（デフォルト: 3600） |

---

## 現在のイシュー（2026-05-15 時点）

### 解決済み（このセッションで修正・コミット済み）
| # | ファイル | 内容 |
|---|----------|------|
| 1 | `js/view/EpisodeListView.js` | `lunchLineHtml`（リクエスト曲）がテンプレートに含まれておらず、楽曲名が一切表示されていなかった |
| 2 | `api/episode-meta.js` | `invalidateCache` が削除済みの `inMemory` 変数を参照 → Cron 実行時に ReferenceError |
| 3 | `api/episode-meta.js` | `processRows` が `broadcastNumber` をエントリに追加していないためソートが無効だった |
| 4 | `api/episode-meta.js` | `extractVideoId` が `youtu.be` 形式の URL に未対応 |
| 5 | `.github/workflows/refresh-meta.yml` | `-o /dev/null` でレスポンスボディを捨てていたため何が起きているか不明だった → ボディとエントリ数をログ出力するよう修正 |

### 未解決
**症状**: 新しくシートに追加した回のコーナー名・楽曲名がサイトに表示されない

**原因候補（未特定）**:
- `processRows` が Sheets の列オフセットをズレて読んでいる（コーナー列の位置が想定と異なる）
- Sheets の videoId 列の URL フォーマットが正しく解析されていない
- `fetchEpisodeManualMetaOnce` の API/JSON マージで、Sheets データが JSON データを空の corners で上書きしている

**次にやること**:
1. GitHub Actions を再実行してログの「取得エントリ数」を確認（正しければ 272 件前後）
2. 特定の回（例: 第X回）を指定して、その回の `videoId` が `/api/episode-meta` レスポンスに含まれているか確認
3. エントリに corners が入っているにもかかわらずサイトで表示されない場合 → merge のvideoId不一致を疑う

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

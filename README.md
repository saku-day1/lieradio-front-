# リエラジ出演者検索

Love Live! Superstar!! のラジオ番組「リエラジ」の放送回を検索・閲覧するファンサイト。  
YouTube API と Google Sheets を組み合わせたアーカイブ型 SPA。

---

## 機能

### フィルタ・検索

| 種別 | 内容 |
|------|------|
| **メンバーフィルタ** | Liella! 11名のクイックボタン。単体選択 or AND 検索（最大5名） |
| **ユニット** | クーカー / トマカノーテ / CatChu! / KALEIDOSCORE / 5yncri5e! 等 14グループ |
| **ステータス** | お気に入り / 視聴済み / 未視聴 / その他動画（耐久・総集編）/ メモあり |
| **詳細検索（ファセット）** | コーナー / リクエスト曲 / ライブ感想 / イベント感想 / アニメ感想 / 誕生日 / 公開録音 / 出来事 |

### その他

- 出演回数ランキング・共演者ランキング・リクエスト曲ランキング
- お気に入り・視聴済み・メモ（`localStorage` 保存）
- バックアップ／復元
- ページネーション（50件/ページ）
- PWA 対応

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | 静的 HTML + Vanilla JS（ES Modules）+ CSS |
| ホスティング | Vercel |
| API | Vercel Serverless Functions（Node.js） |
| キャッシュ | Upstash Redis |
| データソース | YouTube Data API v3 / Google Sheets API |
| CI/CD | GitHub Actions |

---

## データフロー

```
フロント起動
  │
  ├─ GET /api/episodes
  │    YouTube Playlist API → 説明文パース（出演者・欠席者）
  │    → Upstash Redis（TTL: 7日）
  │    → 失敗時: Redis スタッシュ（6時間以内）→ data/episodes.json
  │
  └─ GET /api/episode-meta（並列）
       Google Sheets API → コーナー・タグ・リクエスト曲 処理
       → Upstash Redis（TTL: 1時間）
       → 失敗時: data/episodeMeta.json

取得後
  mergeManualMetaIntoEpisodes()
    videoId で完全一致結合（推測・部分一致は禁止）
    Sheets データが JSON データより優先

  buildFacetCatalog() → ファセット選択肢を生成
  render() → フィルタ適用 → View 描画
```

---

## ファイル構成

```
/
├── index.html                  # SPA エントリ。全 UI を定義
├── style.css                   # グローバルスタイル
├── vercel.json                 # Cron（毎日 UTC 0:00）・ヘッダー設定
│
├── api/
│   ├── episodes.js             # YouTube API 取得・整形・Redis キャッシュ
│   ├── episode-meta.js         # Google Sheets 取得・タグ処理・Redis キャッシュ
│   ├── episodes-refresh.js     # Cron からキャッシュ強制更新
│   └── absence-names.js        # 説明文から欠席者名を抽出するユーティリティ
│
├── data/
│   ├── episodes.json           # API 失敗時フォールバック
│   └── episodeMeta.json        # Google Sheets から生成した静的フォールバック
│
├── js/
│   ├── main.js                 # AppController を生成して init() するだけ
│   ├── constants.js            # キャスト・ユニット定数・色マップ
│   ├── controller/
│   │   └── AppController.js    # フィルタ状態管理・イベント処理・Model/View 橋渡し
│   ├── model/
│   │   ├── EpisodeRepository.js  # データ取得・フィルタ・ソート・ランキング集計
│   │   ├── episodeSearch.js      # ファセット検索ロジック
│   │   ├── facetCatalog.js       # ファセット選択肢の生成
│   │   └── UserPreferences.js    # お気に入り・視聴済み・メモの localStorage 読み書き
│   └── view/
│       ├── EpisodeListView.js    # エピソードリスト描画
│       └── RankingView.js        # ランキングセクション描画
│
├── scripts/                    # 開発用スクリプト（npm run で実行）
│   ├── import-episode-meta.mjs # Google Sheets → data/episodeMeta.json 生成
│   ├── sync-notion.mjs         # Google Sheets → Notion DB 同期
│   ├── verify-absence.mjs      # 欠席情報の検証
│   └── dump-excel.mjs          # Excel 内容のダンプ確認
│
└── .github/workflows/
    ├── refresh-meta.yml        # 手動実行でメタ情報を即時反映
    └── sync-notion.yml         # 手動実行で Notion 同期
```

---

## 環境変数

Vercel の環境変数は **Production・Preview・Development の全スコープ**に設定すること。

### 必須

| 変数名 | 用途 |
|--------|------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 キー |
| `YOUTUBE_PLAYLIST_ID` | 取得対象のプレイリスト ID |
| `KV_REST_API_URL` または `UPSTASH_REDIS_REST_URL` | Upstash Redis エンドポイント |
| `KV_REST_API_TOKEN` または `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis トークン |
| `CRON_SECRET` | 強制更新エンドポイントの認証トークン |
| `GOOGLE_SHEETS_API_KEY` | Google Sheets API キー |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | スプレッドシート ID |

### オプション

| 変数名 | デフォルト | 用途 |
|--------|----------|------|
| `ALLOWED_ORIGIN` | — | CORS 許可オリジン |
| `GOOGLE_SHEETS_SHEET_GID` | 最初のシート | シート GID |
| `EPISODES_CACHE_TTL_MS` | `600000`（10分） | Redis キャッシュ有効期限 |
| `EPISODE_META_CACHE_TTL_SEC` | `3600`（1時間）| メタ情報 Redis TTL |
| `EPISODE_META_CACHE_KEY` | `episode_meta_cache_v1` | メタ情報キャッシュキー |

---

## 開発コマンド

```bash
# Google Sheets からメタ情報を data/episodeMeta.json に生成
npm run import-episode-meta

# 欠席情報の検証
npm run verify-absence

# Notion DB への同期（手動）
npm run sync-notion
```

---

## エピソードメタ情報の更新

Google Sheets でデータを編集したあと、即時反映する手順：

1. GitHub Actions →「メタ情報を今すぐ反映」を手動実行（workflow_dispatch）
2. Actions ログで以下を確認
   - `x-meta-source: sheets`（Sheets から取得できている）
   - `x-meta-count: NNN`（件数が期待通りか）
3. サイトをリロードして確認

### Google Sheets 列構造

| A | B | C | D | E | F〜H | I | J | K〜L | M | N |
|---|---|---|---|---|------|---|---|------|---|---|
| videoId | 回 | コーナー1 | コーナー2 | リクエスト曲 | 備考（誕生日・出来事等） | 出来事 | 公開録音 | ライブ感想 | イベント感想 | アニメ感想 |

---

## データ結合ポリシー

YouTube API データと episodeMeta.json の結合キーは **`videoId` の完全一致のみ**。

以下は結合キーとして使用禁止：
- 動画タイトル / 第○回表記 / 公開日 / 配列順 / 部分一致

公開録音・特別回など通常形式でない動画が存在するため、推測補完は誤った情報の紐づけ事故を引き起こす。

---

## 免責

このサイトはファンが制作した非公式サイトです。  
掲載情報は YouTube の公開情報および有志によるメタ情報を元にしています。  
著作権は各権利者に帰属します。

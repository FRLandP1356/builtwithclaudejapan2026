// The tools the AI guide may call: name, description and input schema, as plain data.
//
// DATA ONLY. This module imports nothing, so the Cloudflare worker can import it (it sends these exact definitions
// to Claude, which means a client can never supply its own tool metadata) and src/ai/tools.ts implements them.
// The descriptions are model-visible Japanese text. Keep each description under 400 characters and each input_schema
// under 2,000 characters when serialised (the worker caps schemas at 4,000).

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** Most years get_series takes at once: every 5-year step from 2020 to 2100. The schema and tools.ts share this one number. */
export const MAX_YEARS = 17;

const AREA_CODE = {
  type: 'string',
  description: '市区町村と政令市は5桁、都道府県は2桁、日本全体は"00"。分からなければ先に find_area で探す',
};

const YEAR = {
  type: 'integer',
  minimum: 2020,
  maximum: 2100,
  description: '2020〜2100年。5の倍数でない年は直前の5の倍数に切り下げ、結果に使った年が入る',
};

const SCENARIO = {
  type: 'object',
  description: '2050年より後の前提。省いた項目は標準。2050年までは前提によらず同じ',
  properties: {
    cwrMult: { type: 'number', minimum: 0.6, maximum: 1.4, description: '子ども女性比にかける倍率（標準1）' },
    migMode: { type: 'string', enum: ['hold', 'fade'], description: 'hold=人口移動を保つ、fade=2100年に向けて0へ弱める' },
    migScale: { type: 'number', minimum: 0, maximum: 1.5, description: '人口移動の強さの倍率（標準1）' },
    infraStrength: {
      type: 'number',
      minimum: 0,
      maximum: 0.01,
      description: '必須の施設が人口の目安を下回ると転出が増える強さ（標準0=なし）',
    },
  },
  additionalProperties: false,
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'find_area',
    description:
      '市区町村・政令市・都道府県・日本全体の名前からコードを探す。スペースは無視し、完全一致、前方一致、部分一致の順に最大8件返す。同じ名前の町村が複数あるので、prefName で見分ける。コードが分からない時は、他の道具の前にこれを使う。',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '地域の名前（一部でもよい）。"日本"や"全国"は全体("00")' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_series',
    description:
      '地域の人口の推移を返す。年ごとの総人口、65歳以上の人数と割合、数字の根拠（official=社人研の公式推計、app_estimate=2050年より後のこのアプリの試算）。years を省くと2020・2030・2040・2050・2060・2075・2100年。scenario で前提を変えられる。',
    input_schema: {
      type: 'object',
      properties: {
        areaCode: AREA_CODE,
        years: { type: 'array', items: YEAR, maxItems: MAX_YEARS, description: '知りたい年（省くと代表的な7つの年）' },
        scenario: SCENARIO,
      },
      required: ['areaCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_sources',
    description:
      '社人研の公式推計（2025〜2050年）とこのアプリの計算の人口を同じ年で並べ、最大の相対差を返す。あわせて2060〜2100年のこのアプリの試算を返す（公式の市区町村別の推計は2050年まで）。公式とアプリがどれだけ合うかを聞かれた時に使う。',
    input_schema: {
      type: 'object',
      properties: { areaCode: AREA_CODE, scenario: SCENARIO },
      required: ['areaCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_projection',
    description:
      '前提を変えた時の2050・2075・2100年の人口を、標準の前提の人口と並べて、差（人数と%）を返す。「移動が減ったら」「出生が増えたら」のような仮定の結果に使う。2050年までは公式推計なので差は0。',
    input_schema: {
      type: 'object',
      properties: { areaCode: AREA_CODE, scenario: SCENARIO },
      required: ['areaCode', 'scenario'],
      additionalProperties: false,
    },
  },
  {
    name: 'facility_check',
    description:
      '市区町村（5桁のみ）の、ある年の人口と、サービス施設48種の人口の目安との比較を返す。status は ok=80%の目安以上、edge=50%の目安以上80%未満、below=50%の目安を下回る。三大都市圏の県は統計の対象外（outsideMlitScope）。「残せる・残せない」ではなく目安との比較として伝える。',
    input_schema: {
      type: 'object',
      properties: {
        areaCode: { type: 'string', description: '市区町村の5桁コードだけ（都道府県・日本全体は不可）' },
        year: YEAR,
        scenario: SCENARIO,
        onlyEssential: { type: 'boolean', description: 'true なら生活に必須の施設だけ' },
      },
      required: ['areaCode', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_allocation',
    description:
      '人口を動かす仮定。対象（都道府県か市区町村）の人口を deltaPercent か deltaPeople のどちらか一方で増減し、同じ人数を他の地域から引く（全国の合計は変わらない）。引く元は既定で全国に人口比。regions と prefCodes で県を限れる。変化の大きい地域と、目安をまたぐ施設を返す（必須の施設は essentialFlips に全部）。',
    input_schema: {
      type: 'object',
      properties: {
        target: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['pref', 'area'] },
            code: { type: 'string', description: 'pref は2桁、area は5桁' },
          },
          required: ['kind', 'code'],
          additionalProperties: false,
        },
        deltaPercent: { type: 'number', description: '対象のその年の人口に対する増減（%）。減らすなら負。deltaPeople とどちらか一方' },
        deltaPeople: { type: 'number', description: '増減する人数。減らすなら負。deltaPercent とどちらか一方' },
        sourceMode: { type: 'string', enum: ['proportional', 'regions'], description: '人口を引く元。既定は proportional（全国に人口比）' },
        prefCodes: { type: 'array', items: { type: 'string' }, description: 'regions の時に引く県の2桁コード' },
        year: YEAR,
        scenario: SCENARIO,
      },
      required: ['target', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_similar_now',
    description:
      '地域のある年の人口に、2020年の人口が最も近い市区町村を最大5件返す（自分自身は除く）。「2100年の〇〇市は、今のどのくらいの町か」に答える時に使う。',
    input_schema: {
      type: 'object',
      properties: { areaCode: AREA_CODE, year: YEAR, scenario: SCENARIO },
      required: ['areaCode', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: 'count_areas',
    description:
      'ある年の人口が below 未満かつ/または above 以上の市区町村が、全国（または prefCode の県）に何件あるかと、例を最大5件返す。below と above のどちらか一方は必須。「3,000人未満の町村は何件か」に使う。',
    input_schema: {
      type: 'object',
      properties: {
        year: YEAR,
        below: { type: 'number', description: 'この人数より少ない' },
        above: { type: 'number', description: 'この人数以上' },
        prefCode: { type: 'string', description: '県に限る時の2桁コード' },
        scenario: SCENARIO,
      },
      required: ['year'],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES: readonly string[] = TOOL_DEFS.map((t) => t.name);

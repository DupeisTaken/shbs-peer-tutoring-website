/** Current role fixtures are the denominator; historical cohorts and auxiliary
 * review records are retained separately and never counted as extra people. */
const tutees = [
  ["emma", "Emma Sun", "9", "math"],
  ["frank", "Frank Wu", "10", "math"],
  ["grace", "Grace Lin", "9", "physics"],
  ["henry", "Henry Xu", "11", "english"],
  ["ivy", "Ivy Yang", "10", "english"],
  ["jack", "Jack Zhou", "12", "english"],
  ["liam", "Liam Foster", "9", "math"],
  ["mia", "Mia Reed", "10", "chemistry"],
  ["noah", "Noah Bell", "11", "apcalc"],
  ["olivia", "Olivia Ward", "9", "chemistry"],
  ["peter", "Peter Gray", "12", "physics"],
  ["quinn", "Quinn Lee", "10", "spanish"],
  ["rachel", "Rachel Cole", "11", "apenglit"],
  ["sam", "Sam Diaz", "9", "apush"],
  ["tina", "Tina Hong", "10", "apcalc"],
  ["umar", "Umar Khan", "12", "economics"],
  ["vera", "Vera Ng", "11", "apcs"],
  ["will", "Will Tan", "9", "spanish"],
  ["xena", "Xena Ross", "10", "apush"],
  ["yuki", "Yuki Sato", "11", "apcs"],
  ["aaron", "Aaron Webb", "9", "algebra2"],
  ["bella", "Bella Cruz", "10", "apbio"],
  ["cory", "Cory Flynn", "11", "precalc"],
  ["dana", "Dana Iverson", "12", "economics"],
  ["eli", "Eli Mercer", "9", "apbio"],
  ["faye", "Faye Okafor", "10", "precalc"],
  ["gabe", "Gabe Solis", "11", "apbio"],
  ["hana", "Hana Kato", "9", "precalc"],
  ["ian", "Ian Boyd", "10", "worldhistory"],
  ["jana", "Jana Petrov", "12", "apenglit"],
  ["kyle", "Kyle Ahmed", "11", "apcalc"],
  ["lena", "Lena Brooks", "10", "spanish"],
  ["pending-kate", "Kate Park", "9", "chemistry"],
  ["pending-omar", "Omar Said", "10", "apcalc"],
  ["pending-lily", "Lily Tran", "11", "apenglit"],
  ["pending-raj", "Raj Mehta", "12", "apcs"],
  ["pending-sara", "Sara Cohen", "9", "spanish"],
  ["pending-tom", "Tom Becker", "10", "apush"],
  ["pending-uma", "Uma Devi", "10", "apbio"],
  ["pending-victor", "Victor Lim", "11", "apphysics"],
  ["pending-wendy", "Wendy Cho", "9", "algebra2"],
  ["pending-zoe", "Zoe Banner", "11", "apbio"],
] as const;
const staff = new Set([
  "umar",
  "ian",
  "jana",
  "lena",
  "pending-raj",
  "pending-sara",
  "pending-tom",
  "pending-uma",
  "pending-victor",
  "pending-wendy",
]);
const unknown = new Set(["mia", "pending-zoe"]);
export const DEMO_TUTEE_EDGE_REASONS: Record<string, string> = {
  frank: "Card appeal and withdrawal review",
  grace: "Schedule-conflict review",
  mia: "Discipline warning and unknown entry provenance",
  noah: "Discipline warning",
  eli: "Unexcused absence",
  cory: "Pending card review",
  will: "Withdrawal request",
  "pending-kate": "Academic confirmation needed",
  "pending-zoe": "Duplicate removed participant and unknown entry provenance",
};
export const DEMO_TUTOR_EDGE_REASONS: Record<string, string> = {
  alice: "Patrol discrepancy",
  bob: "Service-hour deduction",
  karen: "Service-hour deduction",
  leo: "Membership opt-out request",
  evan: "Pending activation and academic review",
  oscar: "Opted out, requesting reentry",
  madonna: "Single name and undated academic record",
  "clash-a": "Colliding default username",
  "clash-b": "Colliding default username",
};
export const DEMO_SCENARIO_TUTEES = tutees.map(
  ([key, name, grade, subject]) => ({
    key,
    name,
    grade,
    subject,
    source: unknown.has(key)
      ? ("UNKNOWN" as const)
      : staff.has(key)
        ? ("STAFF" as const)
        : ("SELF_SERVICE" as const),
    edge: DEMO_TUTEE_EDGE_REASONS[key] ?? null,
  }),
);
export const DEMO_SELF_SERVICE_KEYS = DEMO_SCENARIO_TUTEES.filter(
  (row) => row.source === "SELF_SERVICE",
).map((row) => row.key);
export const DEMO_CURRENT_TUTEE_KEYS = DEMO_SCENARIO_TUTEES.map(
  (row) => row.key,
);
export const DEMO_CURRENT_TUTOR_KEYS = [
  "alice",
  "bob",
  "carol",
  "david",
  "gina",
  "harold",
  "iris",
  "jason",
  "karen",
  "leo",
  "mona",
  "nora",
  "evan",
  "oscar",
  "chair",
  "madonna",
  "clash-a",
  "clash-b",
];

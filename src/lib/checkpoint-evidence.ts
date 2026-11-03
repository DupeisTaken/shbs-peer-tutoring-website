/** Canonical diagnostics remain unchanged in fingerprints, saved plans and CLI
 * receipts. Only website presentation translates this explicitly owned vocabulary;
 * unknown future evidence stays verbatim rather than receiving an invented meaning. */
const chinese: Readonly<Record<string, string>> = {
  "The discipline module must be enabled before reviewing a card.":
    "必须先启用纪律模块，才能审核纪律卡。",
  "Recovery delivery event scope is incomplete.": "恢复通知的事件范围不完整。",
  "Recovery delivery event provenance is missing.":
    "缺少恢复通知的事件来源证据。",
  "Recovery delivery origin is unknown for this event; legacy effects cannot be invented.":
    "此事件的通知来源未知，不能推测旧记录的影响。",
  "Recovery delivery insert/transport coverage is incomplete.":
    "恢复通知的新增记录或发送核验覆盖不完整。",
  "Recovery delivery scope exceeds the supported limit.":
    "恢复通知的范围超过支持上限。",
  "A captured delivery effect has an unknown outcome.":
    "一项已记录的通知发送结果未知。",
  "A captured delivery needs its owning request/report recovery adapter.":
    "一项已记录的通知须通过所属申请或报表流程恢复。",
  "The ordinary action repaired unsupported legacy data; its old snapshot cannot be restored.":
    "原操作修复了不受支持的旧数据，不能恢复其旧快照。",
  "A logical event mixes preserved facts and compensation with indistinguishable delivery effects.":
    "同一逻辑操作混合了应保留与应修正的事实，无法区分其通知影响。",
  "Unsupported checkpoint format or adapter version.":
    "不支持此检查点格式或恢复规则版本。",
  "Checkpoint dependency limits exceeded.": "检查点依赖范围超过支持上限。",
  "Recovery requires origin replication mode.":
    "恢复要求数据库采用原始写入复制模式。",
  "Unsupported checkpoint snapshot.": "不支持此检查点快照。",
  "Request source, grouping or exact ownership changed.":
    "申请来源、分组或准确归属已改变。",
  "A fresh request draft requires one exact current or retained owner.":
    "新的申请草稿必须具有唯一且准确的当前或保留所有者。",
  "Unsupported request descendants require review before creating an owner draft.":
    "创建本人审核草稿前，必须先审核不受支持的申请后续操作。",
  "Current request invalidity remains in effect; resolve it through its owning workflow.":
    "当前申请的无效标记仍然有效，请通过所属流程处理。",
  "Unsupported unmaterialized request changes require a separate correction.":
    "尚未建立参与记录的申请含不受支持的变更，须另行修正。",
  "Restoration awaits the owner's new submission, current policy agreement and ordinary mailbox verification.":
    "恢复仍等待本人重新提交申请、同意当前条款并完成正常邮箱验证。",
  "Create a new owner-review draft from captured request-local answers; keep the original request closed.":
    "依据已保存的申请答案创建本人审核草稿；原申请保持关闭。",
  "Append a compensating answer revision through current signup validation and restore supported captured assignment memberships.":
    "按当前报名校验新增补偿修订，并恢复受支持的已保存分配关系。",
  "Original signatures, accepted policies, submission priority, proof/deadline state and finalized decisions.":
    "原始签名、已接受条款、申请优先时间、验证与截止状态及最终决定。",
  "Current account security, restrictions and ownership.":
    "当前账号安全、限制与归属。",
  "Recorded participant ownership or grouping changed.":
    "已记录的参与者归属或分组已改变。",
  "Punishment reversal would restore an assignment whose identity, schedule or enrollment consent changed.":
    "撤销处罚将恢复一项身份、时间安排或报名同意已改变的分配。",
  "Captured assignment belongs to an ended period.":
    "已保存的分配属于已结束的周期。",
  "Assignment tutor is not currently eligible to teach.":
    "该分配的辅导伙伴当前不具备授课资格。",
  "Assignment learner is not currently participating.":
    "该分配的学习伙伴当前未参与项目。",
  "Captured assignment schedule or ownership changed.":
    "已保存分配的时间安排或归属已改变。",
  "Captured enrollment consent or exact ownership changed.":
    "已保存报名的同意记录或准确归属已改变。",
  "Current enrollment is closed, invalid, in another period or past its proof deadline.":
    "当前报名已关闭、无效、属于其他周期或超过验证截止时间。",
  "Current legacy signup invalidity remains in effect.":
    "旧报名的当前无效标记仍然有效。",
  "Current-quarter withdrawal restrictions require their owning restoration workflow.":
    "本季度退出限制必须通过所属恢复流程处理。",
  "Current approved tutor qualification is required; old override proof cannot be reused.":
    "必须具有当前已批准的辅导资格；不能重复使用旧的例外授权。",
  "A current participant account restriction prevents assignment restoration.":
    "参与者账号的当前限制阻止恢复分配。",
  "Captured teaching group has conflicting current schedules.":
    "已保存的辅导小组存在当前时间冲突。",
  "Refresh checkpoint source does not match.": "刷新检查点的来源不匹配。",
  "Another period activation requires a separate reviewed recovery.":
    "其他周期已经启用，须另行审核恢复。",
  "Refresh participant grouping or exact ownership changed.":
    "刷新涉及的参与者分组或准确归属已改变。",
  "New independent participation prevents reversing this period activation.":
    "新增的独立参与记录阻止撤销此次周期启用。",
  "Independent departure facts cannot be replaced by refresh recovery.":
    "刷新恢复不能替换独立的离校事实。",
  "A closed refresh-derived request lacks exact owner/draft evidence.":
    "刷新导致关闭的申请缺少准确所有者或草稿证据。",
  "Captured refresh assignment schedule, consent or ownership changed.":
    "刷新中已保存分配的安排、同意或归属已改变。",
  "Closed graduation-derived requests remain closed; their owners must submit fresh reviewed drafts.":
    "因毕业而关闭的申请保持关闭，须由本人审核并重新提交草稿。",
  "Restore the captured source period and attributable lifecycle effects, preserving actual opening and completed schedule history.":
    "恢复已保存的来源周期及可归因的参与状态影响，保留实际开放记录与已完成计划历史。",
  "Retain current security settings; restore eligible captured memberships with current consent and qualification checks.":
    "保留当前安全设置；按当前同意与资格校验恢复符合条件的已保存参与关系。",
  "Current credentials, security features, restrictions, consent and immutable decisions.":
    "当前凭据、安全功能、限制、同意记录与不可变更的决定。",
  "Completed refresh schedules, actual signup-opening evidence, new staged settings and all original history.":
    "已完成刷新计划、实际报名开放证据、新暂存设置及全部原始历史。",
  "Original card issuance changed.": "原始纪律卡签发记录已改变。",
  "Independent discipline, membership or attendance decisions require their own correction.":
    "独立的纪律、参与状态或出勤决定须通过各自流程修正。",
  "Standing is recomputed from all current cards; historical balances and reviewer credentials are never restored.":
    "将依据全部当前纪律卡重算状态；不恢复历史余额或审核者凭据。",
  "Recompute punishment consequences with current participation checks.":
    "依据当前参与资格校验重新计算处罚影响。",
  "Original issuance and all previous review/removal evidence.":
    "原始签发及此前全部审核与移除证据。",
  "Independent cards, credentials, access restrictions and policy agreements.":
    "独立纪律卡、凭据、访问限制与条款同意记录。",
  "Current signup is closed, invalid or past its verification deadline.":
    "当前报名已关闭、无效或超过验证截止时间。",
  "Current-quarter withdrawal requires a fresh participation decision.":
    "本季度已退出，须重新作出参与决定。",
  "Current account restrictions prevent restoring participation.":
    "当前账号限制阻止恢复参与状态。",
  "Participant period, grouping or exact ownership changed.":
    "参与者周期、分组或准确归属已改变。",
  "New independent assignments require their owning workflow.":
    "新增独立分配须通过所属流程处理。",
  "A captured assignment was removed or rebound.":
    "一项已保存分配已被移除或重新绑定。",
  "Assignment scheduling changed.": "分配的时间安排已改变。",
  "Unsupported participant descendant changes require a separate correction.":
    "不受支持的参与者后续变更须另行修正。",
  "Unsupported participant status.": "不支持此参与状态。",
  "Assignments with later attendance, consent or other unsupported work cannot be replayed.":
    "已有后续出勤、同意记录或其他不受支持操作的分配不能重放。",
  "Restore only the captured memberships in retained current-period assignments.":
    "仅恢复仍保留的本周期分配中已保存的参与关系。",
  "Current credentials, access restrictions, names, academic reports and policy agreements.":
    "当前凭据、访问限制、姓名、学业报告与条款同意记录。",
  "Original requests, decisions, attendance and service-hour history.":
    "原始申请、决定、出勤与服务小时历史。",
  "Attendance ownership, merge structure, roster, period or original scheduling association changed.":
    "出勤归属、合并结构、名单、周期或原始安排关联已改变。",
  "Attendance has an uncaptured participant.":
    "出勤包含未保存到检查点的参与者。",
  "Independent attendance, patrol, card or membership decisions require their own correction.":
    "独立的出勤、巡查、纪律卡或参与状态决定须通过各自流程修正。",
  "Patrol evidence is evaluated again. A previous flag decision or service-hour deduction is never copied back.":
    "将重新评估巡查证据，不复制恢复先前的异常决定或服务小时扣减。",
  "Apply a new attendance correction across the complete merged block.":
    "对完整的合并出勤时段新增出勤修正。",
  "Recompute service hours, automatic absence cards and punishment consequences.":
    "重新计算服务小时、自动缺勤卡与处罚影响。",
  "Reopen the current discrepancy for fresh review when applicable.":
    "适用时重新开启当前异常，交由重新审核。",
  "Original submissions, correction audits and merged-block associations.":
    "原始提交、修正审计与合并时段关联。",
  "Independent cards, patrol observations, access restrictions and consent.":
    "独立纪律卡、巡查观察、访问限制与同意记录。",
  ACADEMIC_CONFIRMATION_REQUIRED: "参与前须完成当前学业信息确认。",
  "The team must publish the policy before participation opens.":
    "参与开放前，团队必须先发布条款。",
  "Read and accept the current policy before participating.":
    "参与前请阅读并同意当前条款。",
  "This request is already processed.": "此申请已经处理。",
};
const statuses: Readonly<Record<string, string>> = {
  ACTIVE: "参与中",
  PENDING: "待处理",
  INACTIVE: "未参与",
  ARCHIVED: "已归档",
  OPTED_OUT: "已退出",
  GRADUATED: "已毕业",
  TRANSFERRED: "已转学",
};
export function checkpointEvidenceText(
  message: string,
  locale: string,
): string {
  if (!locale.toLowerCase().startsWith("zh")) return message;
  if (chinese[message]) return chinese[message];
  let match = /^Restore (TUTOR|TUTEE) (.+) lifecycle to ([A-Z_]+)\.$/.exec(
    message,
  );
  if (match)
    return `将${match[1] === "TUTOR" ? "辅导伙伴" : "学习伙伴"} ${match[2]} 的参与状态恢复为${statuses[match[3]!] ?? match[3]}。`;
  match =
    /^Create (\d+) owner-review draft\(s\); restoration awaits their ordinary fresh submissions\.$/.exec(
      message,
    );
  if (match)
    return `创建 ${match[1]} 份本人审核草稿；恢复仍等待通过正常流程重新提交。`;
  match = /^Record a new ([a-z_]+) review of this card\.$/.exec(message);
  if (match)
    return `为此纪律卡新增审核记录，结果为 ${({ pending: "待审核", valid: "有效", invalid: "无效", approved: "已批准", rejected: "已拒绝", upheld: "维持", overturned: "已撤销" } as Record<string, string>)[match[1]!] ?? match[1]}。`;
  match = /^Missing recovery coverage: (.+)\.$/.exec(message);
  if (match) return `缺少恢复覆盖：${match[1]}。`;
  match = /^Unsupported refresh descendant: (.+)\.$/.exec(message);
  if (match) return `不支持的刷新后续记录：${match[1]}。`;
  match = /^Complete required fields: (.+)\.$/.exec(message);
  if (match) return `请填写必填字段：${match[1]}。`;
  return message;
}

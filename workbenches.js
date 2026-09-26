/* ============================================================
   workbenches.js  —  THE PRODUCT
   ------------------------------------------------------------
   Six employee workbenches, defined as DATA (schema §8.1 of the
   design doc). engine.js contains ZERO role-specific code: it
   fetches a workbench definition and renders it. Adding a 7th
   role means adding a record here — no engine change, no
   release. That is the claim this demo is built to let you test:
   edit this file, reload, and the cockpit serves the new role.
   ============================================================ */

window.TENANT = { org: 'ACME Corporation', label: 'Demo tenant', switcher_note: 'In production the role switcher appears only when an employee is assigned more than one workbench.' };

/* ---- authoring sugar: keeps the records declarative and short ---- */
const A = (label, act, cls) => ({ label, act, cls: cls || 'gho' });
const B = (kind, text) => [kind, text];
const S = (t, note) => ({ t, note: note || '' });

window.WORKBENCHES = [

/* ============================================================
   1 — ACCOUNTS PAYABLE CLERK
   ============================================================ */
{
  key: 'ap_clerk', title: 'Accounts Payable — Clerk', short: 'AP Clerk',
  accent: 'amber', density: 'comfortable', version: 4, status: 'published',
  required_permission: 'workbench.ap_clerk.view',
  identity: { first_name: 'Dana', name: 'Dana Whitfield', initials: 'DW', sub: 'AP Clerk · Finance' },
  rollout: { strategy: 'canary', pct: 25, groups: ['SG-Cockpit-Finance-AP-Pilot'], freeze: ['month-end close'] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['erp.corp.internal', '*.sap.corp.internal', 'bank.corp.internal', 'docs.corp.internal'],
    requires_confirmation: ['payment.*', 'vendor.bank_details.*'],
    data_classes: ['financial', 'confidential'],
    session_max_minutes: 240
  },
  metrics: { automated: 34, saved: 128, waiting: 2, exception_rate: 11 },
  counts: { invoice_queue: 6, exceptions: 2, vendors: 3 },
  nav: [
    { key: 'inbox', focus: ['invoice_queue'], label: 'My Queue', icon: '▤', badge: 'invoice_queue' },
    { key: 'exceptions', focus: ['exception_tray'], label: 'Exceptions', icon: '⚠', badge: 'exceptions', alert: true },
    { key: 'vendors', focus: [], label: 'Vendors', icon: '◫', badge: 'vendors' },
    { key: 'reports', focus: [], label: 'Reports', icon: '◔', perm: 'ap.reports.view' }
  ],
  widgets: [
    { key: 'invoice_queue', kind: 'queue', title: 'Invoice queue', size: 'wide', position: 1,
      auto: { level: 'approve', skill: 'ap/invoice-triage@2.3.1' },
      note: 'Agent matched, tolerance-checked and narrated every row. Nothing is posted without you.',
      items: [
        { id: 'INV-40218', title: 'Northwind Industrial · INV-40218', sub: 'CAD 18,420.00 · received 2h ago',
          badges: [B('warn','price variance +2.4%'), B('info','PO 4500912331'), B('info','3-way matched')],
          why: 'Line 2 is 2.4% above the PO price — outside the 2.0% tolerance. Third mismatch from this vendor in 90 days, so it is flagged, not auto-posted.',
          detail: {
            kv: [['Vendor','Northwind Industrial (VEN-1042)'],['Invoice','INV-40218 · CAD 18,420.00'],['PO','4500912331 · CAD 17,980.00'],
                 ['Variance','+CAD 440.00 (+2.4%)'],['Goods receipt','GR-778120 · complete'],['Terms','Net 30 · due in 21 days'],
                 ['Risk score','62 / 100 — repeat variance pattern']],
            evidence: 'erp.purchase_order(4500912331).lines[2].unit_price = 17.98\ninvoice.lines[2].unit_price        = 18.41\ntolerance_policy(AP-TOL-2 v3)      = 2.0%\nlast_90d_vendor_variances(VEN-1042) = 3\n\n# Agent note\nVariance is on freight surcharge, not unit price.\nFreight is normally itemised separately by this vendor.',
            actions: [A('Run exception triage', 'run', 'pri'), A('View source document', 'doc'), A('Ask about this vendor', 'ask')]
          },
          run: { label: 'Exception triage', skill: 'ap/exception-triage@1.4.0',
            steps: [
              S('Pulled invoice, PO and goods receipt from ERP', '3-way match, read-only'),
              S('Recomputed line variance against AP-TOL-2', '+2.4% vs 2.0% ceiling'),
              S('Checked vendor history', '3 variances in 90 days'),
              S('Drafted exception note for Dana', 'skill ap/exception-notes@1.2.0')
            ],
            gate: { kind: 'approval', title: 'Approve or hold INV-40218',
              kv: [['Object','INV-40218 · Northwind Industrial'],['Blast radius','1 invoice · CAD 18,420.00'],
                   ['If approved','Posts to ERP and schedules payment on the next run'],['Reversible?','Yes — reversal possible before the payment run']],
              policy: 'AP-TOL-2 v3 · tolerances & variance approval',
              options: [{ label: 'Approve full amount', act: 'approve', cls: 'pri' }, { label: 'Hold & request credit note', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Wrote decision + reason code to ERP', 'approval AP-99120'), S('Scheduled for the next payment run', 'Thu 06:00 · CAD 18,420.00'), S('Closed the exception', 'audit event recorded') ],
            outcome: 'Approved and scheduled for payment.'
          }
        },
        { id: 'INV-40225', title: 'Helios Energy · INV-40225', sub: 'CAD 44,900.00 · received 40m ago',
          badges: [B('bad','bank details changed 3d ago'), B('warn','high value'), B('info','PO 4500912440')],
          why: 'Vendor bank details changed 3 days ago and this is a high-value invoice. Bank-detail change + high value + new account is the classic business-email-compromise pattern, so payment release requires a verified callback — typed confirmation, not a click.',
          detail: {
            kv: [['Vendor','Helios Energy (VEN-2210)'],['Invoice','INV-40225 · CAD 44,900.00'],['PO','4500912440 · CAD 44,900.00'],
                 ['Bank change','3 days ago · account ****4471 (was ****9930)'],['Change source','email request, not the vendor portal'],
                 ['Duplicate check','clear'],['Risk score','91 / 100 — out-of-band bank change']],
            evidence: 'vendor.bank_details.changed_at   = 2026-09-21T08:14Z\nvendor.bank_details.source       = email(ap@helios-energy.example)\nportal_change_request_found      = false\nduplicate_invoice_scan(INV-40225) = clear\npolicy_match(AP-BANK-1)           = requires verified callback',
            actions: [A('Start callback verification', 'run', 'pri'), A('View source document', 'doc')]
          },
          run: { label: 'Bank-change verification', skill: 'ap/bank-change-guard@1.1.0',
            steps: [
              S('Detected out-of-band bank-detail change', 'email, not portal'),
              S('Searched the vendor portal for the same change', 'no matching request found'),
              S('Cross-checked against the contact record', 'phone number on file, not the one in the email'),
              S('Prepared the verification checklist', 'skill ap/bank-change-guard@1.1.0')
            ],
            gate: { kind: 'typeconfirm', title: 'Verified callback required before release',
              word: 'CONFIRM',
              kv: [['Object','INV-40225 · CAD 44,900.00 → account ****4471'],['Blast radius','1 payment · CAD 44,900.00'],
                   ['Required','You spoke to a known contact at Helios on the number already on file'],
                   ['Reversible?','No — outbound payment to a new account is irreversible']],
              policy: 'AP-BANK-1 v2 · bank-detail change control',
              options: [{ label: 'Release payment', act: 'approve', cls: 'danger' }, { label: 'Cancel & quarantine invoice', act: 'reject' }] },
            after: [ S('Recorded callback attestation', 'who: D. Whitfield · when: now'), S('Released payment', 'CAD 44,900.00 → ****4471'), S('Raised a vendor-security follow-up', 'ticket SEC-2210') ],
            outcome: 'Payment released with a recorded callback attestation.'
          }
        },
        { id: 'INV-40221', title: 'Cascade Freight · INV-40221', sub: 'CAD 2,140.00 · received 3h ago',
          badges: [B('bad','possible duplicate'), B('info','no PO · under threshold')],
          why: 'Amount, vendor and description match INV-39877, paid 26 days ago. Under the auto-post threshold but the duplicate signal is decisive.',
          detail: {
            kv: [['Vendor','Cascade Freight (VEN-0771)'],['Invoice','INV-40221 · CAD 2,140.00'],['Original','INV-39877 · paid 2026-08-29'],
                 ['Similarity','0.97 (vendor, amount, service period)'],['Risk score','78 / 100 — duplicate']],
            evidence: 'duplicate_scan(INV-40221) = score 0.97\ntop_match: INV-39877 (paid 2026-08-29, CAD 2,140.00)\nservice_period_overlap = full\ndecision_needed(human) = duplicate_or_legitimate',
            actions: [A('Run duplicate review', 'run', 'pri'), A('View source document', 'doc')]
          },
          run: { label: 'Duplicate review', skill: 'ap/duplicate-guard@3.0.2',
            steps: [ S('Scanned open + paid invoices', '97% similarity'), S('Compared service periods', 'full overlap'), S('Checked whether a credit note exists', 'none found') ],
            gate: { kind: 'approval', title: 'Duplicate or legitimate?',
              kv: [['Object','INV-40221 vs paid INV-39877'],['Blast radius','CAD 2,140.00'],['Reversible?','Yes, but chasing a refund costs ~40 minutes']],
              policy: 'AP-DUP-1 v5 · duplicate invoice control',
              options: [{ label: 'Mark as duplicate & notify vendor', act: 'approve', cls: 'pri' }, { label: 'Legitimate — release payment', act: 'hold' }] },
            after: [ S('Marked as duplicate, no payment scheduled', ''), S('Drafted vendor notification', 'queued for your review') ],
            outcome: 'Duplicate blocked. Vendor notification drafted.'
          }
        },
        { id: 'INV-40228', title: 'Selkirk Parts · INV-40228', sub: 'CAD 6,780.00 · received 5h ago',
          badges: [B('warn','no goods receipt'), B('info','PO 4500912455')],
          why: 'Three-way match fails: the PO exists but no goods receipt was recorded. Either the shipment never arrived or receiving did not log it.',
          detail: {
            kv: [['Vendor','Selkirk Parts (VEN-1188)'],['Invoice','INV-40228 · CAD 6,780.00'],['PO','4500912455 · open'],
                 ['Goods receipt','missing'],['Days since PO','9'],['Risk score','40 / 100 — process gap']],
            evidence: 'three_way_match(INV-40228) = RECEIPT_MISSING\nerp.goods_receipts(4500912455) = [];\nreceiving_owner = warehouse@corp.internal\npolicy_match(AP-REC-3) = hold_until_receipt',
            actions: [A('Run mismatch triage', 'run', 'pri'), A('View source document', 'doc')]
          },
          run: { label: 'Receipt chase', skill: 'ap/receipt-chase@1.0.5',
            steps: [ S('Confirmed PO is open and in tolerance', 'CAD 6,780.00'), S('Searched receiving logs', 'no receipt'), S('Identified the receiving owner', 'warehouse@corp.internal') ],
            gate: { kind: 'send', title: 'Send receipt request?',
              kv: [['Recipient','warehouse@corp.internal (internal only)'],['Blast radius','1 internal email'],['Reversible?','Partly — apologies do not unsend']],
              policy: 'AP-REC-3 v1 · receipt-before-payment',
              draft: 'Subject: Goods receipt needed — PO 4500912455 (Selkirk Parts)\n\nHi team,\n\nPO 4500912455 for CAD 6,780.00 is invoiced (INV-40228) but has no goods receipt recorded.\nCould you confirm delivery or log the receipt so payment is not held?\n\nThanks,\nDana (AP)' },
            after: [ S('Sent internal receipt request', 'to warehouse@corp.internal'), S('Placed invoice on hold until receipt', 'holds auto-release on match') ],
            outcome: 'Invoice held; receiving chased. Nothing was paid.'
          }
        }
      ] },
    { key: 'exception_tray', kind: 'queue', title: 'Needs a human', size: 'md', position: 2,
      auto: { level: 'suggest', skill: 'ap/exception-notes@1.2.0' },
      note: 'Exceptions the agent will not decide, with its own recommendation attached.',
      items: [
        { id: 'EXC-771', title: 'Vendor asks to split payment across entities', sub: 'Northwind · CAD 18,420.00',
          badges: [B('warn','policy gap'), B('info','no rule matched')], why: 'No policy covers entity-split payment requests. The agent refused to guess and narrated why.',
          detail: { kv: [['Request','Split across 2 ACME entities'],['Policy lookup','no matching rule'],['Agent action','refused to act, escalated']],
            evidence: 'policy_lookup("split payment across entities") = []\nagent.decision = refuse_and_escalate(reason="no matching policy")\n# Not a failure — an honest stop.',
            actions: [A('Ask the agent for options', 'ask', 'pri')] } },
        { id: 'EXC-774', title: 'FX rate on EUR invoice outside band', sub: 'Helios · EUR 12,300.00',
          badges: [B('info','explained')], why: 'The agent explained the variance and recommended accepting it; the decision is yours.',
          detail: { kv: [['Invoice','EUR 12,300.00'],['Rate used','1.4712'],['Band','1.4550–1.4700'],['Agent recommendation','accept — 0.08% impact, monthly close in 3 days']],
            evidence: 'fx.rate(EUR/CAD) = 1.4712\nband = [1.4550, 1.4700]\nimpact_if_accepted = CAD 148.00\nagent.recommendation = accept(reason="immaterial vs close deadline")',
            actions: [A('Accept recommendation', 'close', 'pri'), A('Override & hold', 'close')] } }
      ] },
    { key: 'approval_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'md', position: 3,
      note: 'Everything blocked on a human, from agents, peers and delegates. One place, never a modal.',
      sla_hours: 4 },
    { key: 'saved', kind: 'metric', title: 'Automated today', size: 'sm', position: 4,
      config: { value_key: 'automated', sub: 'runs completed', saved_key: 'saved' } },
    { key: 'ask', kind: 'chat', title: 'Ask about a vendor or invoice', size: 'sm', position: 5,
      auto: { level: 'suggest', skill: 'ap/policy-qa@2.0.0' },
      suggested: ['Why is Helios on hold?', 'Summarise Northwind in 90 days', 'What is our freight tolerance?'],
      answers: [
        { q: 'Why is Helios on hold?', a: 'INV-40225 (CAD 44,900.00) was flagged because the vendor bank details changed 3 days ago by email rather than through the vendor portal. AP-BANK-1 requires a verified callback on the number already on file before release.', cite: 'AP-BANK-1 v2 §2.1 · erp.invoice(INV-40225) · vendor.bank_details.changed_at' },
        { q: 'Summarise Northwind in 90 days', a: '11 invoices, CAD 214,300.00 paid, 3 price variances (all on freight surcharges, all within 2.4%), average approval time 1.2 days. No duplicates. Trend: freight surcharges are becoming an itemised pattern worth renegotiating.', cite: 'erp.vendor(VEN-1042) · 11 invoices · 90 days' },
        { q: 'What is our freight tolerance?', a: 'Freight is held to the same 2.0% tolerance as goods, per AP-TOL-2 v3 §4. Anything above that needs your decision — which is exactly why INV-40218 is on your queue.', cite: 'AP-TOL-2 v3 §4 · tolerances' },
        { q: 'Can I pay this one today?', a: 'I will not decide a payment. I can show you what the policy requires and what the evidence says, then you decide. For INV-40225 that means a verified callback; for INV-40218 an approve-or-hold decision.', cite: 'AP-BANK-1 v2 · AP-TOL-2 v3' }
      ],
      tasks: [
        { id: 'CHAT-AP-SWEEP', q: 'Match today’s invoices', keys: ['match', 'invoices'],
          sub: 'chat-initiated · ap/invoice-triage@2.3.1',
          does: 'On it — reading today’s invoice inbox, matching against purchase orders and goods receipts, and stopping at anything that is not a clean three-way match.',
          run: { label: 'Daily invoice sweep (asked in chat)', skill: 'ap/invoice-triage@2.3.1',
            steps: [
              S('Read today’s invoice inbox', '14 rows since 06:00'),
              S('Matched against PO and goods receipt', '9 clean three-way matches'),
              S('Checked vendor history and bank details', '1 vendor flagged — details changed 3 days ago'),
              S('Annotated the clean rows', 'annotations only, nothing posted'),
              S('Stopped at the exceptions', '5 rows need a human')
            ],
            gate: { kind: 'approval', title: 'Release the 5 matched exceptions',
              kv: [['Object','5 invoices outside tolerance or flagged for change'],['Blast radius','CAD 96,400.00 of payment volume'],['Why held','1 tolerance breach, 1 duplicate signal, 2 missing receipts, 1 bank change'],['Reversible?','Yes until release — then it becomes a credit-note process']],
              policy: 'AP-POL-2 v4 · exception release',
              options: [{ label: 'Release the 5', act: 'approve', cls: 'pri' }, { label: 'Open each one', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [
              S('Released 5 invoices to the payment run', 'next run 16:00'),
              S('Annotations posted', 'no ledger entries — annotation scope only'),
              S('Exception summary mailed to you', 'not to the vendors')
            ],
            outcome: 'Sweep asked for in chat, exceptions released by you, nothing else written.' } },
        { id: 'CHAT-AP-EXPENSE', q: 'Check expense queue', keys: ['expense', 'expenses'],
          does: 'Expense queue: 7 claims waiting. 5 are inside policy and pre-cleared by the category owner; 2 need you — a CAD 3,140 hospitality claim with no attendee list, and one that duplicates a June claim. I have not submitted anything: expense approval is not in my grant.',
          cite: 'expense.queue(open) = 7 · AP-EXP-3 v1' },
        { id: 'CHAT-AP-EXPORT', q: 'Export AP summary', keys: ['export', 'summary'],
          sub: 'chat-initiated · ap/report-draft@1.2.0',
          does: 'Drafting the month-to-date AP summary and holding it for your review — it leaves the workbench, so it is a review-and-send gate rather than a silent export.',
          run: { label: 'AP summary export (asked in chat)', skill: 'ap/report-draft@1.2.0',
            steps: [
              S('Pulled the ledger extract', '1–24 September'),
              S('Built the exception and aging tables', '41 invoices · 6 exceptions'),
              S('Stripped vendor bank details', 'never included in an export'),
              S('Drafted the covering note', 'for the Finance Business Partner')
            ],
            gate: { kind: 'send', title: 'Send the AP summary?',
              kv: [['Recipient','Finance Business Partner (internal)'],['Blast radius','1 message · 41 invoices · CAD 1.9M summarised'],['Reversible?','No — sent messages cannot be recalled']],
              policy: 'AP-REP-1 v2 · reporting exports',
              draft: 'Subject: AP summary — 1–24 Sep\n\n41 invoices processed, CAD 1.9M.\n- 9 auto-annotated three-way matches\n- 5 exceptions held for release (CAD 96,400)\n- 2 duplicate signals investigated, 1 confirmed\n\nNo bank details are included in this export.\n\nDana' },
            after: [
              S('Sent after your review', 'logged to the reporting register'),
              S('Stored with the message hash', 'audit trail intact')
            ],
            outcome: 'Summary reviewed by you and sent, with the hash on record.' } }
      ]
    }
  ]
},

/* ============================================================
   2 — SALES REPRESENTATIVE
   ============================================================ */
{
  key: 'sales_rep', title: 'Sales — Account Executive', short: 'Sales Rep',
  accent: 'blue', density: 'comfortable', version: 7, status: 'published',
  required_permission: 'workbench.sales_rep.view',
  identity: { first_name: 'Marcus', name: 'Marcus Bell', initials: 'MB', sub: 'Account Executive · Revenue' },
  rollout: { strategy: 'all', pct: 100, groups: ['SG-Cockpit-Sales'], freeze: ['quarter-end close'] },
  policies: {
    autonomy_ceiling: 'suggest',
    allowed_domains: ['crm.corp.internal', '*.salesforce.corp.internal', 'intranet.corp.internal'],
    requires_confirmation: ['crm.write.*', 'customer.email.*', 'quote.discount.*'],
    data_classes: ['confidential', 'customer_pii'],
    session_max_minutes: 240
  },
  metrics: { automated: 19, saved: 96, waiting: 3, briefings: 6 },
  counts: { accounts: 6, quiet: 2, briefing: 6 },
  nav: [
    { key: 'inbox', focus: ['account_queue'], label: 'My Accounts', icon: '▤', badge: 'accounts' },
    { key: 'quiet', focus: ['account_queue'], label: 'Quiet accounts', icon: '◌', badge: 'quiet', alert: true },
    { key: 'quotes', focus: ['account_queue'], label: 'Quotes', icon: '▦' },
    { key: 'activity', focus: [], label: 'Activity', icon: '◔' }
  ],
  widgets: [
    { key: 'account_queue', kind: 'queue', title: 'Accounts needing attention', size: 'wide', position: 1,
      auto: { level: 'suggest', skill: 'sales/account-research@1.9.0' },
      note: 'Every row was researched for you: news, CRM history, support tickets, usage. Nothing is sent to a customer by the agent.',
      items: [
        { id: 'Northwind Industrial', title: 'Northwind Industrial · Q3 renewal', sub: 'Renewal in 12 days · CAD 148,000.00 ARR',
          badges: [B('warn','renewal in 12d'), B('info','briefing ready'), B('info','usage −18%')],
          why: 'Usage dropped 18% in 60 days and an open P1 support ticket from 9 days ago is unresolved. Renewal-risk pattern, so a briefing and a save plan were drafted.',
          detail: {
            kv: [['Account','Northwind Industrial'],['Renewal','2026-10-06 · CAD 148,000.00 ARR'],['Usage','−18% in 60 days'],
                 ['Open tickets','P1 (9 days, west-region latency)'],['Last contact','41 days ago'],['Risk','high']],
            evidence: 'crm.account(NW-1042).renewal_date   = 2026-10-06\nusage.delta_60d                     = -18%\nsupport.open_p1(NW-1042)            = 1 (age 9d)\nnews.sentiment(Northwind, 30d)      = neutral\nengage.champion_last_seen           = 41d ago\n\n# Suggested play\nLead with the P1 fix, then renew at flat rather than uplift.',
            actions: [A('Open pre-call briefing', 'run', 'pri'), A('Draft outreach', 'send')]
          },
          run: { label: 'Build pre-call briefing', skill: 'sales/account-research@1.9.0',
            steps: [
              S('Pulled CRM history and renewal terms', 'CAD 148,000.00 · 12 days'),
              S('Searched news and public signals', 'no adverse news'),
              S('Joined open support tickets', 'P1 latency ticket, 9 days old'),
              S('Computed usage trend', '−18% over 60 days'),
              S('Drafted a renewal-save plan', 'lead with the fix, renew flat'),
              S('Drafted outreach for your review', 'nothing sent')
            ],
            gate: { kind: 'send', title: 'Review & send — nothing leaves without you',
              kv: [['Recipient','hello@northwind.example (external)'],['Blast radius','1 customer email'],['Sent by','You, not the automation'],['Reversible?','No — external communication is treated as irreversible']],
              policy: 'SALES-EXT-1 v4 · external communication',
              draft: 'Subject: Your west-region P1 — and your renewal\n\nHi Priya,\n\nBefore renewal talks on the 6th: your west-region latency ticket (P1, 9 days) is the root cause of most of your recent friction, and I would rather fix it than renew around it.\n\nCan I get 20 minutes Thursday to walk through the fix plan? If we solve that, I am proposing we renew flat this year rather than take an uplift.\n\nMarcus' },
            after: [ S('Sent after your approval', 'logged to CRM'), S('Logged the send against the opportunity', 'note pre-filled by the agent'), S('Set a follow-up reminder', 'Thursday 09:00') ],
            outcome: 'Outreach sent by you, logged by the automation.'
          }
        },
        { id: 'Cascade Freight', title: 'Cascade Freight · gone quiet', sub: 'No contact in 34 days · CAD 62,000.00 open pipeline',
          badges: [B('warn','quiet 34d'), B('info','draft ready')],
          why: 'No contact in 34 days and the champion changed roles according to a public announcement. Quiet-account pattern with a champion risk.',
          detail: { kv: [['Account','Cascade Freight'],['Open pipeline','CAD 62,000.00'],['Last contact','34 days'],['Champion','changed role (public)'],['Risk','medium-high']],
            evidence: 'crm.activity(CAS-0771).last_contact = 34d\nengagement.champion_status          = changed_role\npublic.announcement(2026-09-12)     = new Director of Ops\npipeline.open(CAS-0771)             = CAD 62,000.00',
            actions: [A('Review drafted outreach', 'send', 'pri'), A('Research the new champion', 'ask')] } },
        { id: 'Helios Energy', title: 'Helios Energy · quote refresh', sub: 'CAD 212,000.00 · discount request 14%',
          badges: [B('warn','discount > 12%'), B('info','pricing matrix v12')],
          why: 'Requested 14% discount, above your 12% authority. The agent regenerated the quote from the current pricing matrix and prepared the approval, but cannot approve it.',
          detail: { kv: [['Account','Helios Energy'],['Quote','Q-88213 · CAD 212,000.00'],['Requested discount','14%'],['Your authority','12%'],['Margin impact','−CAD 4,240.00']],
            evidence: 'quote(Q-88213).requested_discount = 14%\nauthority(sales_rep, discount)        = 12%\npricing_matrix.version                = v12\nmargin.delta_at_14pct                 = -CAD 4,240.00\nagent.cannot_approve                  = true',
            actions: [A('Prepare discount approval', 'run', 'pri'), A('Regenerate quote at 12%', 'quote')] },
          run: { label: 'Discount approval pack', skill: 'sales/quote-regen@2.1.0',
            steps: [ S('Regenerated quote from pricing matrix v12', 'CAD 212,000.00'), S('Computed margin impact', '−CAD 4,240.00 at 14%'), S('Searched for a comparable win', 'similar deal at 13.5%') ],
            gate: { kind: 'approval', title: 'Discount above your authority',
              kv: [['Object','Quote Q-88213 · Helios Energy'],['Requested','14%'],['Your authority','12%'],['Reversible?','Yes — until the customer signs']],
              policy: 'SALES-DISC-3 v2 · discount authority ladder',
              options: [{ label: 'Request approval from Sales Lead', act: 'approve', cls: 'pri' }, { label: 'Counter at 12%', act: 'hold' }] },
            after: [ S('Routed to Sales Lead for approval', 'SLA 4h'), S('Held the quote at 12% pending decision', 'nothing sent to the customer') ],
            outcome: 'Escalated with numbers attached; no customer contact.'
          }
        }
      ] },
    { key: 'pipeline', kind: 'metric', title: 'Pipeline touched', size: 'sm', position: 2,
      config: { value_key: 'accounts', sub: 'accounts researched', saved_key: 'briefings', saved_label: 'briefings ready' } },
    { key: 'approval_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'md', position: 3,
      note: 'Discount requests, quote approvals, and anything the agent escalated.', sla_hours: 4 },
    { key: 'ask', kind: 'chat', title: 'Ask about an account', size: 'md', position: 4,
      auto: { level: 'suggest', skill: 'sales/account-qa@1.0.0' },
      suggested: ['What changed at Northwind?', 'Who is the new champion at Cascade?', 'Draft a save plan'],
      answers: [
        { q: 'What changed at Northwind?', a: 'Three things: usage fell 18% in 60 days, there is an open P1 west-region latency ticket nine days old, and your champion has not been seen for 41 days. The latency ticket is the most likely cause and the renewal is in 12 days.', cite: 'usage.delta_60d · support.open_p1 · crm.activity(NW-1042)' },
        { q: 'Who is the new champion at Cascade?', a: 'Public announcements name a new Director of Operations as of 2026-09-12, so the previous champion changed roles. I have not verified whether they still sponsor the project — that is a question for your next call.', cite: 'public.announcement(2026-09-12) · engagement.champion_status' },
        { q: 'Draft a save plan', a: 'Drafted: fix the P1 first, propose renewing flat instead of the planned uplift, and lead with the latency fix rather than price. It is waiting in the Northwind briefing for your review — I will not send anything to a customer.', cite: 'sales/renewal-save-playbook v3' }
      ] }
  ]
},

/* ============================================================
   3 — HR COORDINATOR
   ============================================================ */
{
  key: 'hr_coord', title: 'People Operations — Coordinator', short: 'HR Coordinator',
  accent: 'violet', density: 'comfortable', version: 6, status: 'published',
  required_permission: 'workbench.hr_coord.view',
  identity: { first_name: 'Priya', name: 'Priya Raman', initials: 'PR', sub: 'HR Coordinator · People Ops' },
  rollout: { strategy: 'canary', pct: 50, groups: ['SG-Cockpit-PeopleOps-Pilot'], freeze: ['open-enrollment'] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['hr.corp.internal', 'intranet.corp.internal', 'policy.corp.internal'],
    requires_confirmation: ['employee.message.*', 'hr.decision.*', 'payroll.*'],
    data_classes: ['confidential', 'employee_pii', 'sensitive'],
    session_max_minutes: 180
  },
  metrics: { automated: 27, saved: 154, waiting: 2, onboardings: 3 },
  counts: { onboarding: 3, reminders: 4, offboarding: 1 },
  nav: [
    { key: 'inbox', focus: ['onboarding_queue'], label: 'Onboarding', icon: '▤', badge: 'onboarding' },
    { key: 'reminders', focus: ['onboarding_queue'], label: 'Employee messages', icon: '✉', badge: 'reminders', alert: true },
    { key: 'offboard', focus: ['onboarding_queue'], label: 'Offboarding', icon: '◇', badge: 'offboarding' },
    { key: 'policy', focus: ['policy_ask'], label: 'Policy library', icon: '§' }
  ],
  widgets: [
    { key: 'onboarding_queue', kind: 'queue', title: 'Onboarding & offboarding', size: 'wide', position: 1,
      auto: { level: 'approve', skill: 'hr/onboarding-orchestrator@3.2.0' },
      note: 'The agent derives checklist state, chases the other teams, and drafts every message. Anything that decides a person\u2019s outcome is yours.',
      items: [
        { id: 'Jordan Lee', title: 'Jordan Lee · starts Monday', sub: 'Senior Analyst · Calgary · 7 of 9 tasks done',
          badges: [B('warn','2 tasks blocked'), B('info','day 1 in 3 days')],
          why: 'IT laptop provisioning and the payroll profile are both blocked. The agent chased both owners twice and has now escalated to you rather than sending more reminders.',
          detail: {
            kv: [['Person','Jordan Lee · Senior Analyst'],['Start','2026-09-28 (Monday)'],['Checklist','7 / 9 complete'],
                 ['Blocked','IT laptop (owner: IT Ops) · payroll profile (owner: Payroll)'],['Chases sent','2 (automated)'],['Risk','day-1 readiness']],
            evidence: 'onboarding(OL-3391).tasks = 9; done = 7\nblocked: [it.laptop, payroll.profile]\nagent.chase_count = 2\nescalation_rule(HR-ONB-2) = escalate_to_coordinator_after_2_chases',
            actions: [A('Escalate both blockers', 'run', 'pri'), A('View checklist', 'doc')]
          },
          run: { label: 'Escalate blockers', skill: 'hr/onboarding-orchestrator@3.2.0',
            steps: [ S('Pulled the checklist from the HR platform', '7/9 complete'), S('Identified both blockers and their owners', 'IT Ops, Payroll'), S('Counted prior automated chases', '2 (policy ceiling)'), S('Drafted escalation to the owners', 'short, specific, no blame') ],
            gate: { kind: 'send', title: 'Send escalation to IT Ops & Payroll?',
              kv: [['Recipients','it-ops@ and payroll@ (internal)'],['Blast radius','1 internal email, 2 teams'],['Reversible?','Partly — internal, but it is still a record']],
              policy: 'HR-ONB-2 v3 · escalation after 2 automated chases',
              draft: 'Subject: Blocked for Jordan Lee — starts Monday\n\nTwo items are blocking a Monday start:\n\n1. IT laptop (owner: IT Ops) — requested 6 days ago\n2. Payroll profile (owner: Payroll) — requested 4 days ago\n\nEverything else is complete. If either cannot land before Friday, tell me and I will re-sequence day 1.\n\nPriya\nPeople Ops' },
            after: [ S('Escalation sent', 'both owners notified'), S('Re-check scheduled', 'Friday 08:00'), S('Updated the onboarding record', 'audit event recorded') ],
            outcome: 'Escalated to humans; blockers now visible before day 1.'
          }
        },
        { id: 'Aisha Khan', title: 'Aisha Khan · work-permit expiry', sub: 'Expires in 21 days · reminder drafted',
          badges: [B('bad','legal deadline'), B('warn','wording needs review')],
          why: 'Work-permit expiry is a legal deadline, so the reminder is queued for your review rather than sent. The agent drafted the wording and cited the policy; it will not send anything carrying a legal deadline unsanctioned.',
          detail: {
            kv: [['Person','Aisha Khan · Engineer'],['Permit expiry','2026-10-15 (21 days)'],['Required action','Renewal appointment before expiry'],
                 ['Policy','HR-LEG-7 · immigration deadline handling'],['Draft status','awaiting your wording approval']],
            evidence: 'hr.people(AK-2210).permit_expiry = 2026-10-15\npolicy_match(HR-LEG-7 v4)          = requires_human_wording_approval\ndeadlines_this_quarter             = 4 employees\nagent.will_not_send_alone          = true (legal deadline)',
            actions: [A('Review drafted reminder', 'run', 'pri'), A('View immigration policy', 'doc')]
          },
          run: { label: 'Prepare deadline reminder', skill: 'hr/deadline-watch@2.0.1',
            steps: [ S('Detected the deadline from the HR platform', '21 days out'), S('Matched the policy that governs it', 'HR-LEG-7 v4'), S('Drafted a plain-language reminder', 'cites the policy, no legal advice'), S('Attached the renewal steps', '3 steps, with the portal link') ],
            gate: { kind: 'send', title: 'Approve the wording before it goes',
              kv: [['Recipient','Aisha Khan (employee · confidential)'],['Blast radius','1 employee message carrying a legal deadline'],['Reversible?','No — but the tone is what you are approving']],
              policy: 'HR-LEG-7 v4 · human wording approval for legal deadlines',
              draft: 'Subject: Your work permit renewal (expires 15 October)\n\nHi Aisha,\n\nYour work permit expires on 15 October, 21 days from now. Renewal processing has been running 3\u20134 weeks, so the window to book an appointment is closing.\n\nSteps:\n1. Book the appointment at the immigration portal (link)\n2. Upload the confirmation to the HR platform\n3. Tell me if anything is unclear or if costs are an issue \u2014 there is a process for that\n\nI am tracking this so you do not have to remember it.\n\nPriya\nPeople Ops' },
            after: [ S('Reminder sent with your wording', 'logged to the employee record'), S('Started a 7-day re-check', 'follow-up if no action'), S('Recorded the deadline decision', 'audit event, HR-LEG-7 cited') ],
            outcome: 'Reminder sent on legal wording you approved.'
          }
        },
        { id: 'Marco Silva', title: 'Marco Silva · offboarding Friday', sub: 'Last day in 4 days · 11-step deprovisioning',
          badges: [B('warn','irreversible fan-out'), B('info','11 systems')],
          why: 'Offboarding fans out into 11 systems, several of which are irreversible (mailbox conversion, badge deactivation). The agent prepared the entire fan-out and refuses to execute it unattended.',
          detail: {
            kv: [['Person','Marco Silva · Account Manager'],['Last day','2026-10-02'],['Systems','11 (mailbox, SSO, badge, laptop, 6 apps, payroll)'],
                 ['Irreversible','mailbox conversion, badge deactivation'],['Warm handover','3 accounts in flight'],['Policy','HR-OFF-1']],
            evidence: 'offboarding(MS-1180).systems = 11\nirreversible = ["mailbox.convert","badge.deactivate"]\nin_flight_accounts = 3 (warm handover required)\nagent.will_not_execute_unattended = true\npolicy_match(HR-OFF-1 v2) = human_release_required',
            actions: [A('Review the fan-out plan', 'run', 'pri'), A('View accounts in flight', 'doc')]
          },
          run: { label: 'Offboarding fan-out plan', skill: 'hr/offboarding@2.4.0',
            steps: [ S('Enumerated systems owned by Marco', '11 systems'), S('Flagged irreversible steps', 'mailbox conversion, badge'), S('Identified 3 accounts in flight', 'handover needed'), S('Built a sequenced plan', 'reversible first, irreversible last') ],
            gate: { kind: 'typeconfirm', title: 'Release the offboarding fan-out',
              word: 'RELEASE',
              kv: [['Object','Marco Silva · 11 systems'],['Blast radius','11 systems, 2 irreversible steps'],['Sequencing','reversible steps run first, irreversible last'],['Reversible?','No for 2 of 11']],
              policy: 'HR-OFF-1 v2 · human release for irreversible fan-out',
              options: [{ label: 'Release all 11 steps', act: 'approve', cls: 'danger' }, { label: 'Hold irreversible steps until handover', act: 'hold' }] },
            after: [ S('Executed 9 reversible steps', 'access revoked, apps disabled'), S('Held 2 irreversible steps', 'pending handover completion'), S('Notified 4 system owners', 'tracking recorded') ],
            outcome: 'Reversible steps done; irreversible steps held for handover.'
          }
        }
      ] },
    { key: 'approval_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'md', position: 2,
      note: 'HR decisions and any message to an employee that carries a decision.', sla_hours: 8 },
    { key: 'policy_ask', kind: 'chat', title: 'Policy Q&A — cited, or it refuses', size: 'md', position: 3,
      auto: { level: 'suggest', skill: 'hr/policy-qa@4.1.0' },
      suggested: ['Parental leave top-up for 12 months?', 'Notice period for a manager', 'Can I approve a 3-week extension?'],
      answers: [
        { q: 'Parental leave top-up for 12 months?', a: 'Top-up is 85% of salary for 12 months for the birth or adoption parent, and 8 weeks for the non-birth parent under the Alberta plan. The Quebec-specific case differs and I do not have an authoritative source for it \u2014 ask your HR partner rather than quoting me.', cite: 'HR-LEA-004 v6 \u00a73.2 \u00b7 effective 2026-04-01' },
        { q: 'Notice period for a manager', a: 'Manager-level notice is 4 weeks in writing, and 8 weeks if the role owns a P&L. Both are in the policy I am reading; anything outside says "consult Legal", which is what I would do rather than advise you.', cite: 'HR-SEP-002 v3 \u00a75.1' },
        { q: 'Can I approve a 3-week extension?', a: 'No. Extensions beyond 2 weeks need the People Ops Manager, per HR-TER-006. I can prepare the request with the evidence and the right approver attached \u2014 that is a routing job, not a decision.', cite: 'HR-TER-006 v2 \u00a72.4' },
        { q: 'Is that legal advice?', a: 'No, and I will not give it. I answer from the policy documents in the library, cite the version, and hand anything judgement-heavy to a human. If I cannot find a source, I say so instead of answering.', cite: 'HR/policy-qa grounding rules \u00b7 refusal-on-low-confidence' }
      ] }
  ]
},

/* ============================================================
   4 — IT SUPPORT
   ============================================================ */
{
  key: 'it_support', title: 'IT Support — Engineer', short: 'IT Support',
  accent: 'red', density: 'compact', version: 9, status: 'published',
  required_permission: 'workbench.it_support.view',
  identity: { first_name: 'Alex', name: 'Alex Kim', initials: 'AK', sub: 'IT Support · Infrastructure' },
  rollout: { strategy: 'all', pct: 100, groups: ['SG-Cockpit-IT'], freeze: [] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['itsm.corp.internal', '*.svc.corp.internal', 'kms.corp.internal', 'vault.corp.internal'],
    requires_confirmation: ['identity.revoke.*', 'group.privileged.*', 'device.wipe.*'],
    data_classes: ['internal', 'confidential'],
    session_max_minutes: 240
  },
  metrics: { automated: 22, saved: 71, waiting: 2, mttr: 14 },
  counts: { tickets: 8, destructive: 1, requests: 5 },
  nav: [
    { key: 'inbox', focus: ['ticket_queue'], label: 'Ticket queue', icon: '▤', badge: 'tickets' },
    { key: 'destructive', focus: ['ticket_queue'], label: 'Needs release', icon: '⚠', badge: 'destructive', alert: true },
    { key: 'requests', focus: ['ticket_queue'], label: 'Service requests', icon: '▦', badge: 'requests' },
    { key: 'runbooks', focus: ['runbook'], label: 'Runbooks', icon: '⌘' },
    { key: 'lane', focus: ['lane_live'], label: 'Browser lane', icon: '◉' }
  ],
  widgets: [
    { key: 'ticket_queue', kind: 'queue', title: 'Tickets — triaged and diagnosed', size: 'wide', position: 1,
      auto: { level: 'approve', skill: 'it/triage@4.0.0' },
      note: 'Diagnostics and non-destructive steps run automatically. Every destructive step stops here and waits for you.',
      items: [
        { id: 'INC-88214', title: 'INC-88214 · Laptop cannot reach VPN', sub: 'Karen Ng · P2 · 18m ago',
          badges: [B('bad','destructive step pending'), B('warn','P2'), B('info','runbook matched')],
          why: 'Certificate is revoked-and-replaced: the fix needs an identity revocation step, which is destructive and security-relevant. Diagnosis is complete and the exact object is identified.',
          detail: {
            kv: [['Ticket','INC-88214 · P2 · Karen Ng'],['Device','CN=kng-2419 (MacBook Pro 14)'],['Symptom','VPN auth fails: certificate expired'],
                 ['Diagnosis','expired cert; device key not rotated'],['Runbook','VPN-CERT-ROTATE v7'],['Steps done','4 of 6 (all non-destructive)'],
                 ['Blast radius','1 device · 1 identity']],
            evidence: 'itsm.ticket(INC-88214).priority   = P2\ncert(kng-2419).not_after          = 2026-09-23 (expired)\nrunbook(VPN-CERT-ROTATE v7)       = matched\nsteps.destructive                 = ["identity.revoke(kng-2419)"]\npolicy_match(IT-SEC-12 v3)        = human_release_required\n\n# Everything up to and including step 4 is already done.',
            actions: [A('Continue runbook to step 5', 'run', 'pri'), A('Open the runbook', 'doc')]
          },
          run: { label: 'Run VPN-CERT-ROTATE v7', skill: 'it/vpn-cert-rotate@7.0.0',
            steps: [
              S('Read the ticket and matched the runbook', 'VPN-CERT-ROTATE v7'),
              S('Verified identity of the requester', 'ticket → HR record → device owner'),
              S('Confirmed the certificate is expired', 'not_after 2026-09-23'),
              S('Ran non-destructive diagnostics', '4/6 steps done, all read-only'),
              S('Stopped at the destructive step', 'identity.revoke(kng-2419)')
            ],
            gate: { kind: 'typeconfirm', title: 'Destructive step — release required',
              word: 'REVOKE',
              kv: [['Object','CN=kng-2419 · Karen Ng'],['Blast radius','1 device, 1 identity'],['What happens','Old certificate revoked, new key issued, VPN re-enrolled'],
                   ['Reversible?','No — revocation cannot be undone, but re-issue is fast'],['Policy','IT-SEC-12 \u00a74']],
              policy: 'IT-SEC-12 v3 \u00a74 · identity revocation control',
              options: [{ label: 'Release revocation & rotation', act: 'approve', cls: 'danger' }, { label: 'Cancel runbook', act: 'reject' }] },
            after: [ S('Revoked the expired certificate', 'CN=kng-2419'), S('Issued and enrolled a new key', 'device confirmed re-enrolled'), S('Verified VPN reachability', 'PASS'), S('Updated and closed the ticket', 'with a plain-language note') ],
            outcome: 'Fixed end to end in 14 minutes, with you releasing the one destructive step.'
          }
        },
        { id: 'REQ-44120', title: 'REQ-44120 · Provision new starter (non-prod)', sub: 'Sandbox only · auto-completed',
          badges: [B('ok','completed autonomously'), B('info','non-prod only')],
          why: 'This is what autonomy inside a grant looks like: the request touched only non-prod systems, so the agent completed it without asking. Note the scope — non-prod only, and it said so.',
          detail: { kv: [['Request','New starter sandbox access'],['Environment','non-prod (sandbox)'],['Actions','3 accounts created, 2 groups added'],['Prod access','not included \u2014 requires a separate release']],
            evidence: 'grant(it/triage@4.0.0).environment = nonprod\nactions.executed = ["create_user(sandbox)","add_group(sandbox-eng)","issue_token(sandbox)" ]\nprod_touched = false\napproval_required = false (within grant)',
            actions: [A('View the run log', 'doc', 'pri')] } },
        { id: 'REQ-44131', title: 'REQ-44131 · Privileged group membership', sub: 'Requested: PrivAccess-Finance',
          badges: [B('warn','privileged'), B('info','needs 2nd approver')],
          why: 'Privileged group changes need a second approver who is not the requester. The agent validated the request, checked for a conflict, and routed it — it will not self-approve.',
          detail: { kv: [['Request','Add user to PrivAccess-Finance'],['Requester','D. Whitfield (AP)'],['Conflict check','passed'],['Second approver','required (not the requester)'],['Policy','IT-ACC-9']],
            evidence: 'request(REQ-44131).group = PrivAccess-Finance\nseparation_of_duties_check = pass\nsecond_approver_required   = true (IT-ACC-9 v2)\nagent.cannot_self_approve  = true',
            actions: [A('Route to second approver', 'run', 'pri'), A('View access review', 'doc')] } },
        { id: 'INC-88220', title: 'INC-88220 \u00b7 Payroll portal session for audit', sub: 'Needs a signed-in session \u00b7 MFA required',
          badges: [B('info','browser lane'), B('warn','waiting at MFA')],
          why: 'The audit team needs three figures out of the payroll portal, which has no API. The agent opened a borrowed Chrome tab in your signed-in session and stopped at the MFA prompt \u2014 it cannot and will not answer that itself.',
          detail: {
            kv: [['Ticket','INC-88220 (audit request)'],['System','hr.corp.internal / payroll (no API)'],['Lane','bsk extension \u00b7 borrowed tab'],['Blocked at','MFA challenge'],['Scope','read 3 figures, nothing else']],
            evidence: 'browser.lane = bsk_extension\ntab = borrowed(owner=karen.ng, confirmation=accepted)\nnavigation = hr.corp.internal/payroll (allow-listed)\nblocked_at = MFA_CHALLENGE\nagent.note = \"credentials and codes are never extracted or stored\"',
            actions: [A('Open the borrowed session', 'run', 'pri'), A('See the page it is on', 'doc')]
          },
          run: { label: 'Read the three figures', skill: 'it/portal-read@1.0.4',
            steps: [
              S('Requested a borrowed tab from your browser', 'you confirmed the borrow'),
              S('Navigated to the allow-listed payroll portal', 'hr.corp.internal/payroll'),
              S('Stopped at the MFA challenge', 'the agent will not answer MFA'),
              S('Waiting for you to authenticate in your own browser', 'your session, your device')
            ],
            gate: { kind: 'mfa', title: 'Your MFA prompt is waiting in Chrome',
              prompt: 'Sign in to the payroll portal in the borrowed tab, then continue.',
              tab: 'hr.corp.internal \u2014 payroll (borrowed tab, your session)',
              kv: [['Tab','borrowed \u00b7 your signed-in Chrome'],['What the automation can see','page text only, after you authenticate'],
                   ['Credentials','never extracted, never stored \u2014 model-blind vault rules apply'],['Reversible?','Nothing has been written; this is a read']],
              policy: 'IT-ACC-11 v1 \u00b7 no unattended authentication',
              options: [{ label: 'Done \u2014 I authenticated', act: 'approve', cls: 'pri' }, { label: 'Cancel and close the tab', act: 'reject' }] },
            after: [ S('Read the three figures from the authenticated page', 'read-only, no writes'), S('Returned the borrowed tab to you', 'ownership restored'), S('Attached the figures to INC-88220', 'with the page URL and timestamp') ],
            outcome: 'Audit figures captured from a session you authenticated yourself.'
          }
        }
      ] },
    { key: 'runbook', kind: 'run_button', title: 'One-click runbooks', size: 'md', position: 2,
      auto: { level: 'approve', skill: 'it/runbooks@4.0.0' },
      note: 'Named workflows with a declared blast radius. If a runbook would exceed its grant, it stops at the first out-of-scope step.',
      buttons: [
        { label: 'Rotate expiring certificates', sub: '12 devices · non-destructive', act: 'rb', level: 'auto' },
        { label: 'Unlock a locked account', sub: '1 identity · reversible', act: 'rb', level: 'auto' },
        { label: 'Wipe a returned device', sub: 'irreversible · needs release', act: 'rb', level: 'release' },
        { label: 'Grant prod DB read-only', sub: 'prod · needs approval', act: 'rb', level: 'release' }
      ] },
    { key: 'approval_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'md', position: 3,
      note: 'Destructive, security-relevant and out-of-runbook steps only.', sla_hours: 1 },
    { key: 'ask_it', kind: 'chat', title: 'Ask about a device or ticket', size: 'sm', position: 4,
      auto: { level: 'suggest', skill: 'it/fleet-qa@1.2.0' },
      suggested: ['Which certs expire this week?', 'Why did INC-88214 need a release?', 'What changed on kng-2419?'],
      answers: [
        { q: 'Which certs expire this week?', a: 'Twelve device certificates expire in the next 7 days, all on the same rotation profile. Eleven can be rotated non-destructively by the runbook; one (kng-2419) is already expired and needs a revocation release.', cite: 'kms.certificates(expires<7d) = 12' },
        { q: 'Why did INC-88214 need a release?', a: 'Step 5 revokes an identity, which IT-SEC-12 classifies as destructive and security-relevant. Steps 1 to 4 were non-destructive and already ran automatically, so only the revocation waited for you.', cite: 'IT-SEC-12 v3 \u00a74 · runbook VPN-CERT-ROTATE v7' },
        { q: 'What changed on kng-2419?', a: 'Two events today: the certificate expired (2026-09-23) and a revocation was released by you at this session. Before that, the device had no changes for 94 days.', cite: 'itsm.device(kng-2419).events \u00b7 last 24h' }
      ],
      tasks: [
        { id: 'CHAT-IT-CERT', q: 'Rotate the expiring certificates', keys: ['rotate', 'certificates', 'cert'],
          does: 'Done — 12 certificates rotated on the VPN concentrators, 0 failures. Non-destructive and inside the it/vpn-cert-rotate grant, so it completed without a gate. It is in your audit chain, and the 2 devices that did not answer retry at 02:00.',
          cite: 'run logged · it/vpn-cert-rotate@7.0.0 · 12 rotated, 0 failures',
          completes: true },
        { id: 'CHAT-IT-WIPE', q: 'Wipe the decommissioned laptop', keys: ['wipe', 'laptop', 'decommission'],
          sub: 'chat-initiated · it/device-lifecycle@2.4.0',
          does: 'Starting the disposal workflow for LT-2291. I will bring it up to the erase and stop there — device.wipe.* needs a typed release.',
          run: { label: 'Device wipe (asked in chat)', skill: 'it/device-lifecycle@2.4.0',
            steps: [
              S('Verified the asset is decommissioned', 'LT-2291 · retired 2026-09-10'),
              S('Checked for an active owner', 'none — returned by M. Osei'),
              S('Escrowed the recovery keys', 'to the recovery vault'),
              S('Stopped before the erase', 'device.wipe.* is a typed release')
            ],
            gate: { kind: 'typeconfirm', title: 'Wipe LT-2291', word: 'WIPE',
              kv: [['Object','LT-2291 · encrypted laptop'],['Blast radius','1 device · all local data destroyed'],['Backup','Keys escrowed — recovery is possible but slow'],['Reversible?','No — the erase cannot be undone']],
              policy: 'IT-DEV-1 v3 · device disposal',
              options: [{ label: 'Wipe the device', act: 'approve', cls: 'danger' }, { label: 'Hold', act: 'hold' }] },
            after: [
              S('Erase confirmed by the device', 'certificate captured'),
              S('Asset marked disposed in the CMDB', 'audit event IT-DEV-LT2291')
            ],
            outcome: 'Device wiped after a typed release, with the certificate on file.' } }
      ]
    },
    { key: 'lane_live', kind: 'run_button', title: 'Browser lane \u2014 live', size: 'md', position: 5,
      lane: true,
      note: 'Drives the real bsk daemon through the local bridge (lane.py). The bridge navigates ONLY to allow-listed hosts and never borrows a tab you own \u2014 it creates tabs in the Agent Window, which bsk closes.',
      buttons: [
        { label: 'Run the live lane sequence', sub: 'real session \u2192 allow-listed tab \u2192 accessibility observation \u2192 screenshot', act: 'seq' },
        { label: 'Open a real human handoff', sub: 'a request-help overlay waits for you in your browser', act: 'help' },
        { label: 'Stop the lane session', sub: 'closes the Agent Window tabs bsk owns', act: 'stop' }
      ] }
  ]
},

/* ============================================================
   5 — FINANCE ANALYST
   ============================================================ */
{
  key: 'fin_analyst', title: 'Finance — Analyst (month-end)', short: 'Finance Analyst',
  accent: 'teal', density: 'comfortable', version: 3, status: 'published',
  required_permission: 'workbench.fin_analyst.view',
  identity: { first_name: 'Sofia', name: 'Sofia Marchetti', initials: 'SM', sub: 'Finance Analyst · Controllership' },
  rollout: { strategy: 'canary', pct: 40, groups: ['SG-Cockpit-Finance-Close'], freeze: ['month-end close', 'quarter-end close'] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['erp.corp.internal', 'bi.corp.internal', 'docs.corp.internal'],
    requires_confirmation: ['journal.post.*', 'forecast.write.*'],
    data_classes: ['financial', 'confidential'],
    session_max_minutes: 300
  },
  metrics: { automated: 41, saved: 187, waiting: 2, close_pct: 62 },
  counts: { tasks: 7, variances: 3, journals: 2 },
  nav: [
    { key: 'inbox', focus: ['close_form'], label: 'Close checklist', icon: '▤', badge: 'tasks' },
    { key: 'exceptions', focus: ['variance_queue'], label: 'Variance analysis', icon: '⚠', badge: 'variances', alert: true },
    { key: 'journals', focus: ['close_form'], label: 'Journals', icon: '▦', badge: 'journals' },
    { key: 'reports', focus: [], label: 'Report pack', icon: '◔' }
  ],
  widgets: [
    { key: 'close_form', kind: 'form', title: 'Close task — Cloud spend accrual (pre-filled)', size: 'wide', position: 1,
      auto: { level: 'approve', skill: 'fin/accrual-extract@2.2.0' },
      note: 'The agent read the vendor statements and pre-filled the journal. You verify and submit — the agent cannot post to the ledger.',
      fields: [
        { label: 'Account', value: '6110 — Cloud & hosting', autofilled: true, src: 'erp.account(6110)' },
        { label: 'Amount', value: 'CAD 84,312.40', autofilled: true, src: 'Σ vendor statements (4)' },
        { label: 'Period', value: '2026-09', autofilled: true, src: 'close.period' },
        { label: 'Support', value: '4 statements · 3 reconciled, 1 estimated', autofilled: true, src: 'docs.corp.internal/cloud-billing' },
        { label: 'Cost centre', value: 'CC-4410 (Platform)', autofilled: false, src: 'your input required' }
      ],
      actions: [A('Verify & prepare journal', 'run', 'pri'), A('Open source statements', 'doc')],
      run: { label: 'Prepare journal entry', skill: 'fin/accrual-extract@2.2.0',
        steps: [
          S('Read 4 vendor statements from the document store', 'extraction, no ledger write'),
          S('Reconciled 3 against the ledger', 'CAD 61,208.90 matched'),
          S('Estimated the 4th from the trailing average', 'CAD 23,103.50 · flagged as estimated'),
          S('Built journal JE-2211 against account 6110', 'not posted')
        ],
        gate: { kind: 'approval', title: 'Post journal JE-2211?',
          kv: [['Object','JE-2211 · CAD 84,312.40 · account 6110'],['Blast radius','1 journal entry in the production ledger'],
               ['Note','CAD 23,103.50 is estimated, not matched to a statement'],['Reversible?','Yes — reversing entry, but it will be visible to the auditor']],
          policy: 'FIN-JE-2 v5 · journal posting control',
          options: [{ label: 'Post journal', act: 'approve', cls: 'pri' }, { label: 'Hold for the missing statement', act: 'hold' }] },
        after: [ S('Posted JE-2211 to the ledger', 'period 2026-09'), S('Linked the 4 source statements', 'evidence attached to the entry'), S('Marked the close task complete', 'checklist 8/13') ],
        outcome: 'Journal posted with evidence attached.'
      }
    },
    { key: 'variance_queue', kind: 'queue', title: 'Variance analysis — pre-narrated', size: 'md', position: 2,
      auto: { level: 'suggest', skill: 'fin/variance-narrator@1.7.0' },
      note: 'The agent explains each variance and cites its drivers. Accepting an explanation writes your forecast note.',
      items: [
        { id: 'VAR-MKT', title: 'Marketing +18% vs forecast', sub: 'CAD 92,000.00 overspend',
          badges: [B('info','explained'), B('info','driver: campaign pull-forward')],
          why: 'Two Q4 campaigns were pulled into September by the CMO, and the spend followed. Timing, not overspend.',
          detail: { kv: [['Variance','+18% (+CAD 92,000.00)'],['Driver','2 campaigns pulled forward'],['Source','CMO decision 2026-09-08'],['Net year effect','neutral']],
            evidence: 'bi.variance(marketing, 2026-09) = +CAD 92,000\ncampaign.PL-2231.pull_forward   = 2026-09-08 (CMO approval)\ncampaign.PL-2240.pull_forward   = 2026-09-11\nq4_budget_delta                 = -CAD 96,000 (offsetting)',
            actions: [A('Accept explanation', 'close', 'pri'), A('Flag for review', 'close')] } },
        { id: 'VAR-CLOUD', title: 'Cloud +31% vs forecast', sub: 'CAD 148,000.00 overspend',
          badges: [B('bad','no internal driver found'), B('warn','unexplained')],
          why: 'No internal driver matches. The agent refused to invent one, said so, and listed what it checked \u2014 this is the honest-stop behaviour, not a failure.',
          detail: { kv: [['Variance','+31% (+CAD 148,000.00)'],['Driver','not identified'],['Checked','campaigns, headcount, migrations, contract changes'],['Recommendation','ask the Platform lead before accepting']],
            evidence: 'bi.variance(cloud, 2026-09) = +CAD 148,000\nchecked_drivers = [campaign, headcount, migration, contract]\nmatching_driver = none\nagent.decision = refuse_to_narrate(reason=\"no evidence\")\n# An invented explanation here would be worse than no explanation.',
            actions: [A('Ask Platform lead (draft)', 'run', 'pri'), A('Accept as unexplained', 'close')] },
            run: { label: 'Draft the question', skill: 'fin/variance-narrator@1.7.0',
              steps: [ S('Re-checked the 4 driver candidates', 'no match'), S('Pulled the 3 largest cost lines', 'compute, storage, egress'), S('Drafted a specific question for the owner', 'with the numbers attached') ],
              gate: { kind: 'send', title: 'Send the question to the Platform lead?',
                kv: [['Recipient','platform-lead@corp.internal (internal)'],['Blast radius','1 internal message'],['Reversible?','Partly']],
                policy: 'FIN-VAR-1 v2 · unexplained variance must be raised, not narrated',
                draft: 'Subject: Cloud +31% in September \u2014 can you confirm the driver?\n\nCloud came in CAD 148,000 above forecast for September.\nI checked campaigns, headcount, migrations and contract changes and found no internal driver.\n\nThe three largest lines:\n  compute   +CAD 61,200\n  storage   +CAD 44,900\n  egress    +CAD 41,900\n\nIs this a migration artifact, or should we treat it as a run-rate change? I need it before I file the variance pack.\n\nSofia' },
              after: [ S('Question sent', 'traceable to the variance record'), S('Variance marked \"pending owner input\"', 'not silently accepted'), S('Close checklist updated', 'blocking item flagged') ],
              outcome: 'Raised to the owner with numbers attached; nothing invented.' } }
      ] },
    { key: 'close_metric', kind: 'metric', title: 'Close progress', size: 'sm', position: 3,
      config: { value_key: 'close_pct', suffix: '%', sub: '5 days to deadline', saved_key: 'saved' } },
    { key: 'approval_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'sm', position: 4,
      note: 'Journal postings and forecast writes.', sla_hours: 8 },
    { key: 'ask_fin', kind: 'chat', title: 'Ask about a variance', size: 'md', position: 5,
      auto: { level: 'suggest', skill: 'fin/variance-qa@1.0.0' },
      suggested: ['Why is cloud over?', 'What is still open for close?', 'Show unexplained variances'],
      answers: [
        { q: 'Why is cloud over?', a: 'I do not know, and I will not guess. I checked campaigns, headcount, migrations and contract changes; none explains CAD 148,000. There is a question drafted for the Platform lead with the three largest lines attached.', cite: 'bi.variance(cloud, 2026-09) \u00b7 checked_drivers = 4 \u00b7 matching = 0' },
        { q: 'What is still open for close?', a: 'Five of thirteen tasks: the cloud accrual journal (JE-2211 prepared, waiting on you), the unexplained cloud variance, two reconciliations, and the intercompany elimination that needs the subsidiary numbers from Thursday.', cite: 'close.checklist(2026-09) \u00b7 8/13 complete' },
        { q: 'Show unexplained variances', a: 'One: cloud +31%. Marketing +18% and freight +6% both have evidenced drivers and are waiting for you to accept the explanation, which writes your forecast note.', cite: 'bi.variance(2026-09).unexplained = 1' }
      ] }
  ]
},

/* ============================================================
   6 — PROCUREMENT COORDINATOR
   ============================================================ */
{
  key: 'procurement', title: 'Procurement — Coordinator', short: 'Procurement',
  accent: 'lime', density: 'comfortable', version: 5, status: 'published',
  required_permission: 'workbench.procurement.view',
  identity: { first_name: 'Tomas', name: 'Tomas Ferreira', initials: 'TF', sub: 'Procurement Coordinator · Supply Chain' },
  rollout: { strategy: 'canary', pct: 30, groups: ['SG-Cockpit-Procurement-Pilot'], freeze: ['quarter-end close'] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['erp.corp.internal', 'supplier.corp.internal', 'docs.corp.internal'],
    requires_confirmation: ['po.release.*', 'vendor.bank_details.*', 'vendor.onboard.*'],
    data_classes: ['financial', 'confidential'],
    session_max_minutes: 240
  },
  metrics: { automated: 16, saved: 63, waiting: 3, savings_ytd: 34000 },
  counts: { requisitions: 5, vendors: 2, renewals: 3 },
  nav: [
    { key: 'inbox', focus: ['requisition_queue'], label: 'Requisitions', icon: '▤', badge: 'requisitions' },
    { key: 'vendors', focus: ['vendor_queue'], label: 'Vendor onboarding', icon: '◫', badge: 'vendors', alert: true },
    { key: 'renewals', focus: ['requisition_queue'], label: 'Renewals', icon: '◌', badge: 'renewals' },
    { key: 'spend', focus: [], label: 'Spend analysis', icon: '◔' }
  ],
  widgets: [
    { key: 'requisition_queue', kind: 'queue', title: 'Requisitions — sourced and compared', size: 'wide', position: 1,
      auto: { level: 'approve', skill: 'proc/sourcing@2.0.0' },
      note: 'The agent found the suppliers, compared the offers and built the PO. Releasing spend above threshold is yours.',
      items: [
        { id: 'REQ-7781', title: 'REQ-7781 · 40 engineering laptops', sub: 'CAD 61,200.00 · 3 quotes compared',
          badges: [B('warn','above release threshold'), B('info','best quote +12% savings'), B('info','preferred vendor')],
          why: 'Above your CAD 25,000 release threshold, so the agent prepared the PO and the comparison but stopped. It also flagged that the preferred vendor is 12% cheaper than the incumbent.',
          detail: {
            kv: [['Request','40 × laptop, engineering spec'],['Requester','IT Ops (bulk refresh)'],['Recommended','Selkirk Parts · CAD 61,200.00'],
                 ['Incumbent quote','CAD 69,600.00 (+12%)'],['Delivery','14 days vs 21 days'],['Threshold','CAD 25,000.00 · your release required']],
            evidence: 'requisition(REQ-7781).spec = engineering_16in\nquotes = [Selkirk 61,200/14d, Incumbent 69,600/21d, Northwind 64,800/18d]\npreferred_vendor_list = [Selkirk, Northwind]\nsavings_vs_incumbent = CAD 8,400 (12%)\npolicy_match(PROC-PO-4 v3) = human_release_above_25k',
            actions: [A('Review quotes & prepare PO', 'run', 'pri'), A('Open comparison sheet', 'doc')]
          },
          run: { label: 'Sourcing comparison', skill: 'proc/sourcing@2.0.0',
            steps: [
              S('Read the requisition spec', '40 units, engineering 16in'),
              S('Solicited and normalised 3 quotes', 'delivery and warranty aligned'),
              S('Checked the preferred-vendor list', '2 of 3 are preferred'),
              S('Built PO draft against the best quote', 'CAD 61,200.00 · 14 days'),
              S('Stopped at the release threshold', 'CAD 61,200 > CAD 25,000')
            ],
            gate: { kind: 'approval', title: 'Release PO 4500912461',
              kv: [['Object','PO 4500912461 · Selkirk Parts · CAD 61,200.00'],['Blast radius','1 purchase order, 40 units'],
                   ['Saving vs incumbent','CAD 8,400.00 (12%)'],['Reversible?','Yes until the vendor acknowledges, then a cancellation fee applies']],
              policy: 'PROC-PO-4 v3 · release thresholds',
              options: [{ label: 'Release the PO', act: 'approve', cls: 'pri' }, { label: 'Request a 4th quote', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Released PO 4500912461 to Selkirk', 'delivery window 14 days'), S('Notified the requester', 'IT Ops, with the comparison attached'), S('Recorded CAD 8,400.00 avoided cost', 'savings log updated') ],
            outcome: 'PO released with the comparison attached and savings logged.'
          }
        },
        { id: 'REQ-7785', title: 'REQ-7785 · Contractor extension', sub: 'CAD 18,900.00 · below threshold',
          badges: [B('ok','within authority'), B('info','rate unchanged')],
          why: 'Below your threshold with an unchanged rate and an approved SOW, so the agent completed it and logged the decision. This is what bounded autonomy looks like.',
          detail: { kv: [['Request','3-month extension'],['Amount','CAD 18,900.00'],['Rate','unchanged'],['SOW','approved'],['Released by','automation, within grant']],
            evidence: 'requisition(REQ-7785).amount = 18,900 < threshold 25,000\nrate_change = 0\nsow.status = approved\ngrant(proc/sourcing@2.0.0).ceiling = approve_within_threshold\naction = auto_release (logged as PROC-AUTO-77)',
            actions: [A('View the automatic decision', 'doc', 'pri')] } },
        { id: 'REQ-7790', title: 'REQ-7790 · Software renewal, usage down', sub: 'CAD 44,000.00 · right-sizing opportunity',
          badges: [B('info','usage \u22129%'), B('warn','auto-renews in 21 days')],
          why: 'Usage fell 9% while the renewal auto-renews in 21 days at full price. The agent recommends right-sizing rather than renewing, and drafted the vendor conversation.',
          detail: { kv: [['Vendor','Zoom-eq · CAD 44,000.00/yr'],['Usage','\u22129% YoY, 38% of licences idle'],['Auto-renew','2026-10-15 (21 days)'],['Recommendation','right-size to 62 licences \u2192 CAD 34,100.00']],
            evidence: 'usage.licences(idle) = 38%\nusage.trend = -9% YoY\nrenewal.auto = 2026-10-15\nrecommended = right_size(62 licences, CAD 34,100)\nagent.will_not_negotiate_alone = true',
            actions: [A('Draft right-sizing request', 'run', 'pri'), A('View usage report', 'doc')] },
            run: { label: 'Draft right-sizing ask', skill: 'proc/renewal-review@1.5.0',
              steps: [ S('Pulled 12 months of licence usage', '38% idle, \u22129% YoY'), S('Modelled three tiers', 'right-size saves CAD 9,900'), S('Checked the contract for renewal terms', '30-day notice required \u2014 21 days left'), S('Drafted the vendor ask', 'evidence-first, polite') ],
              gate: { kind: 'send', title: 'Send the right-sizing request?',
                kv: [['Recipient','account team at the vendor (external)'],['Blast radius','1 external message about a CAD 44,000.00 contract'],['Deadline','30-day notice: 9 days left to act'],['Reversible?','No \u2014 external']],
                policy: 'PROC-REN-2 v2 · renewal rightsizing',
                draft: 'Subject: Renewal 15 Oct \u2014 licence adjustment\n\nBefore the 15 October renewal we would like to right-size.\nOur usage shows 38% of licences idle and a 9% year-over-year decline.\n\nProposal: 62 licences at CAD 34,100 for the coming year, same tier.\nHappy to share the usage report.\nIf we cannot agree before the notice window closes we will take the renewal pro-rata instead.\n\nTomas' },
              after: [ S('Request sent after your review', 'logged to the contract'), S('Set a 9-day action deadline', 'before the notice window closes'), S('Estimated saving recorded', 'CAD 9,900.00') ],
              outcome: 'Vendor asked to right-size, with the usage evidence attached.' } }
      ] },
    { key: 'vendor_queue', kind: 'queue', title: 'Vendor onboarding', size: 'md', position: 2,
      auto: { level: 'approve', skill: 'proc/vendor-onboard@1.4.0' },
      note: 'Document collection and validation are automatic. Bank details and master-data writes are yours.',
      items: [
        { id: 'VEN-2210', title: 'VEN-2210 · Helios Energy (new supplier)', sub: 'Tax docs verified · bank details pending',
          badges: [B('bad','bank details unverified'), B('warn','blocks 2 POs')],
          why: 'All documents validated except the bank details, which were supplied by email rather than the supplier portal \u2014 the same pattern AP flagged on their side. Onboarding is blocked until you confirm.',
          detail: { kv: [['Supplier','Helios Energy'],['Documents','W-8/registration verified, insurance verified'],['Bank details','supplied by email \u2014 unverified'],['Blocking','2 POs totaling CAD 58,400.00']],
            evidence: 'vendor(VEN-2210).docs_verified = 3/4\nbank_details.source = email\nportal_confirmation = false\nblocking_pos = [4500912440, 4500912461]\npolicy_match(PROC-VEN-3 v2) = verified_callback_required',
            actions: [A('Verify bank details', 'run', 'pri'), A('Open document set', 'doc')] },
            run: { label: 'Vendor bank verification', skill: 'proc/vendor-onboard@1.4.0',
              steps: [ S('Validated the document set', '3 of 4 verified'), S('Attempted portal confirmation of bank details', 'no matching change'), S('Cross-checked the registered address and contacts', 'email domain matches, phone does not'), S('Prepared the callback checklist', 'same pattern as AP-BANK-1') ],
              gate: { kind: 'typeconfirm', title: 'Confirm supplier bank details',
                word: 'VERIFY',
                kv: [['Object','VEN-2210 bank details ****4471'],['Blast radius','2 POs (CAD 58,400.00) + future payments to this supplier'],['Required','Verified callback on the number from the registration documents'],['Reversible?','No \u2014 master-data change propagates to payments']],
                policy: 'PROC-VEN-3 v2 \u00b7 supplier master-data control',
                options: [{ label: 'Confirm & activate supplier', act: 'approve', cls: 'danger' }, { label: 'Reject & request portal update', act: 'reject' }] },
              after: [ S('Supplier activated with verified bank details', 'master data updated'), S('Unblocked 2 POs', 'now releasable in the ERP'), S('Recorded the verification', 'audit event PROC-VEN-2210') ],
              outcome: 'Supplier activated only after a verified callback.' }
        },
        { id: 'VEN-2242', title: 'VEN-2242 · Cascade Freight (renewal)', sub: 'Rate card +6% · benchmark requested',
          badges: [B('info','benchmarked'), B('info','below market')],
          why: 'The proposed 6% increase is below the market benchmark of 9% for this lane, so the agent recommends accepting and documented the comparison.',
          detail: { kv: [['Supplier','Cascade Freight'],['Proposed','+6%'],['Benchmark','+9% for this lane'],['Agent recommendation','accept, document the benchmark'],['Review','annual']],
            evidence: 'rate_card_delta = +6%\nbenchmark(lane_west) = +9% (3 carriers)\nrenewal_terms = unchanged\nagent.recommendation = accept(reason="below market")',
            actions: [A('Accept & document', 'close', 'pri'), A('Push for flat', 'close')] } }
      ] },
    { key: 'proc_metric', kind: 'metric', title: 'Cycle time', size: 'sm', position: 3,
      config: { value_key: 'automated', suffix: ' req/wk', sub: '2.3 days average', saved_key: 'savings_ytd', saved_label: 'CAD saved YTD' } },
    { key: 'approval_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'sm', position: 4,
      note: 'Release thresholds, bank details, and master-data changes.', sla_hours: 8 },
    { key: 'ask_proc', kind: 'chat', title: 'Ask about a supplier or PO', size: 'md', position: 5,
      auto: { level: 'suggest', skill: 'proc/spend-qa@1.1.0' },
      suggested: ['Who are we overpaying?', 'What renews in 30 days?', 'Why is Helios blocked?'],
      answers: [
        { q: 'Who are we overpaying?', a: 'Three signals worth acting on: the laptop incumbent is 12% above the best preferred quote (REQ-7781), 38% of the collaboration licences are idle (REQ-7790), and freight lane West is 4% above benchmark despite an increase below market.', cite: 'spend.analysis(2026-Q3) \u00b7 3 opportunities \u00b7 CAD 18,300 estimated' },
        { q: 'What renews in 30 days?', a: 'Four contracts: collaboration software (21 days, auto-renew, right-size drafted), freight lane West (28 days), a security scanner (19 days, no usage change), and cloud storage (30 days, over-provisioned by 2 TB).', cite: 'contracts.renewals(<30d) = 4' },
        { q: 'Why is Helios blocked?', a: 'Their bank details came by email instead of the supplier portal, which is the same pattern Accounts Payable flagged on invoices. PROC-VEN-3 needs a verified callback before the supplier can be activated \u2014 two POs worth CAD 58,400.00 are waiting on it.', cite: 'PROC-VEN-3 v2 \u00b7 vendor(VEN-2210) \u00b7 AP-BANK-1 correlation' }
      ] }
  ]
},

/* ============================================================
   7 — IT MANAGER
   ============================================================ */
{
  key: 'it_manager', title: 'IT — Operations Manager', short: 'IT Manager',
  accent: 'cyan', density: 'compact', version: 3, status: 'published',
  required_permission: 'workbench.it_manager.view',
  identity: { first_name: 'Priya', name: 'Priya Raman', initials: 'PR', sub: 'IT Operations Manager · Service and estate' },
  rollout: { strategy: 'all', pct: 100, groups: ['SG-Cockpit-IT-Leads'], freeze: ['change freeze: month-end close'] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['itsm.corp.internal', 'cmdb.corp.internal', 'asset.corp.internal', 'licensing.corp.internal'],
    requires_confirmation: ['infra.decommission.*', 'identity.revoke.*', 'change.emergency.*'],
    data_classes: ['internal', 'confidential'],
    session_max_minutes: 240
  },
  metrics: { automated: 41, saved: 168, waiting: 3, mttr: 11 },
  counts: { escalations: 3, changes: 1, spend: 2 },
  nav: [
    { key: 'inbox', focus: ['escalation_queue'], label: 'Escalations', icon: '▤', badge: 'escalations' },
    { key: 'changes', focus: ['escalation_queue'], label: 'Change window', icon: '⌥', badge: 'changes', alert: true },
    { key: 'estate', focus: ['estate_run'], label: 'Estate and cost', icon: '◔', badge: 'spend' },
    { key: 'team', focus: ['ask_mgr'], label: 'Ask about the team', icon: '◌' }
  ],
  widgets: [
    { key: 'escalation_queue', kind: 'queue', title: 'Escalations from the team', size: 'wide', position: 1,
      auto: { level: 'approve', skill: 'itsm/escalation-triage@1.3.0' },
      note: 'The agent triages, gathers the evidence and stops at the authority line. Your team is never asked to release something above its own grant.',
      items: [
        { id: 'ESC-3312', title: 'ESC-3312 · Contractor offboarding blocked', sub: '4 of 4 SaaS paths revoked · 1 on-prem account still live, 6 days',
          badges: [B('bad','access still live'), B('warn','6 days past the end date'), B('info','HRIS has no API')],
          why: 'The offboarding run revoked every SaaS path but the on-prem HRIS has no API, so disabling it needs a privileged console session. The account is 6 days past the contractor end date, so the agent escalated instead of forcing a path it is not granted.',
          detail: {
            kv: [['Contractor','R. Feld · ended 2026-09-18 (6 days)'],['Revoked','SSO, VPN, Git, Jira (4 of 4 SaaS)'],['Still live','HRIS on-prem account · admin console only'],['Blast radius','1 account · HR records for 240 employees are readable by it'],['Policy','ITSM-OFF-1 v4 · privileged revoke is a manager release']],
            evidence: 'offboarding(ESC-3312).saas_revoked = 4/4\nhris.account.status = active\nhris.api = none (admin console only)\ndays_since_end = 6\npolicy_match(ITSM-OFF-1 v4) = manager_release_required\nagent.did_not_force_privileged_path = true',
            actions: [A('Release the revocation', 'run', 'pri'), A('Open the offboarding record', 'doc')]
          },
          run: { label: 'Privileged account revocation', skill: 'itsm/offboarding@2.1.0',
            steps: [
              S('Verified the end date against HR', '2026-09-18 · HR-confirmed'),
              S('Revoked 4 of 4 SaaS access paths', 'SSO, VPN, Git, Jira'),
              S('Attempted the HRIS account', 'no API — privileged console only'),
              S('Stopped before touching on-prem', 'privileged revoke is outside the grant'),
              S('Assembled the evidence bundle', '4 systems, signed')
            ],
            gate: { kind: 'approval', title: 'Revoke the HRIS account', who: 'escalated by itsm/offboarding@2.1.0',
              kv: [['Object','HRIS account r.feld (on-prem, privileged)'],['Blast radius','1 account · 240 employee records become readable by it'],['Requested by','HR offboarding, on the confirmed end date'],['Reversible?','No — the account cannot be recreated without a rebuild']],
              policy: 'ITSM-OFF-1 v4 · privileged revoke',
              options: [{ label: 'Revoke the account', act: 'approve', cls: 'pri' }, { label: 'Assign to the platform team', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Account disabled and its session killed', 'HRIS admin console'), S('Evidence bundle sent to compliance', '4 systems, signed'), S('Closed the offboarding record', '6-day SLA: met') ],
            outcome: 'Contractor fully offboarded and the evidence archived.'
          }
        },
        { id: 'CHG-4412', title: 'CHG-4412 · Emergency change — patching the edge', sub: 'requested by Platform Engineering · change freeze active',
          badges: [B('warn','change freeze'), B('ok','backout plan attached'), B('info','340 endpoints')],
          why: 'A remote-code-execution patch affects the edge fleet during the month-end change freeze. The agent has the backout plan, the affected set and the risk note ready. The exception to the freeze is a manager decision, and the agent says the exposure is worse than the freeze risk.',
          detail: {
            kv: [['Change','patch the edge TLS terminator fleet'],['Requested by','Platform Engineering (I. Novak)'],['Freeze','month-end close until 2026-10-02'],['Window','2026-09-25 22:00-23:30'],['Backout','config snapshot + one-command rollback in 4 min'],['Exposure','CVE-2026-4471 · RCE · CVSS 9.1']],
            evidence: 'change(CHG-4412).type = emergency\nfreeze.active = true (until 2026-10-02)\ncve.exposure = CVE-2026-4471 (RCE, CVSS 9.1)\nbackout.plan = attached (tested 2026-08-14)\nendpoints.affected = 340\nagent.assessment = patch now: exposure exceeds freeze risk\nagent.did_not_execute = true',
            actions: [A('Release the change window', 'run', 'pri'), A('Open the risk note', 'doc')]
          },
          run: { label: 'Emergency change release', skill: 'itsm/change-control@3.2.0',
            steps: [
              S('Checked the freeze calendar', 'month-end close active'),
              S('Attached and read the backout plan', 'tested in staging 2026-08-14'),
              S('Sized the blast radius', '340 endpoints · 90-minute window'),
              S('Prepared the on-call comms', 'two windows, one owner each'),
              S('Stopped at the freeze exception', 'ITSM-CHG-7 v2')
            ],
            gate: { kind: 'approval', title: 'Grant the freeze exception', who: 'requested by I. Novak, Platform Lead',
              kv: [['Object','CHG-4412 · 340 endpoints'],['Conflict','month-end change freeze'],['Agent assessment','patch now — exposure higher than freeze risk'],['Reversible?','Yes — one-command rollback in 4 min']],
              policy: 'ITSM-CHG-7 v2 · freeze exceptions',
              options: [{ label: 'Grant the exception', act: 'approve', cls: 'pri' }, { label: 'Hold until the freeze lifts', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Change released for 22:00', 'on-call rota notified'), S('Both windows recorded', 'patch + verification'), S('Posted to the freeze log', 'with the CVE and the assessment') ],
            outcome: 'Edge fleet patched inside the freeze, with the exception documented.'
          }
        },
        { id: 'LIC-2201', title: 'LIC-2201 · Licence true-up exposure', sub: 'CAD 42,300.00 · vendor audit opens in 30 days',
          badges: [B('warn','CAD 42,300.00 exposure'), B('info','audit 2026-10-24'), B('ok','reclaim plan ready')],
          why: 'Telemetry shows 340 seats assigned to people who have not signed in for 90 days, and the vendor audit opens in 30 days. The agent prepared the reclaim waves and a true-up pack for Finance rather than quietly keeping the seats, which would worsen the audit.',
          detail: {
            kv: [['Vendor','collaboration suite · annual · audited'],['Assigned','1,240 seats'],['Idle 90+ days','340 seats (27%)'],['True-up exposure','CAD 42,300.00'],['Audit window','opens 2026-10-24'],['Reclaim plan','3 weekly waves, managers notified first']],
            evidence: 'licences.assigned = 1240\nlicences.idle_90d = 340 (27%)\naudit.opens = 2026-10-24\ntrue_up.exposure = CAD 42,300\noption(silent) = rejected: worsens the audit\nreclaim.plan = 3 waves, manager notification first\nowner.savings_estimate = CAD 42,300 if reclaim completes',
            actions: [A('Send the true-up pack', 'run', 'pri'), A('Open the reclaim list', 'doc')]
          },
          run: { label: 'True-up pack to Finance', skill: 'itsm/licence-audit@1.7.0',
            steps: [
              S('Reconciled telemetry against the vendor report', '340-seat gap'),
              S('Built the reclaim plan in 3 waves', 'managers notified before any removal'),
              S('Drafted the true-up note', 'states the gap up front'),
              S('Stopped before sending externally', 'ITSM-LIC-2 v1')
            ],
            gate: { kind: 'send', title: 'Send the true-up pack to Finance?',
              kv: [['Recipient','Finance Business Partner (internal, outside IT)'],['Blast radius','1 message · discloses CAD 42,300.00 exposure'],['Deadline','audit opens in 30 days'],['Reversible?','No — sent messages cannot be recalled']],
              policy: 'ITSM-LIC-2 v1 · software compliance',
              draft: 'Subject: Licence true-up — collaboration suite (audit opens 24 Oct)\n\nTelemetry shows 340 of 1,240 assigned seats idle for 90+ days: CAD 42,300 annual exposure.\n\nPlan: reclaim in 3 weekly waves with managers notified first, then true up on the reduced count.\nWe are flagging this before the audit window rather than after it.\n\nPriya' },
            after: [ S('Pack sent to Finance', 'exposure number on record'), S('Reclaim wave 1 scheduled', 'Monday 06:00'), S('Audit evidence folder created', 'signed exports attached') ],
            outcome: 'Exposure disclosed early with a reclaim plan attached.'
          }
        }
      ] },
    { key: 'manager_inbox', kind: 'approval_inbox', title: 'Waiting on me', size: 'sm', position: 2,
      note: 'Escalations, freeze exceptions, and anything above team authority.', sla_hours: 8 },
    { key: 'estate_run', kind: 'run_button', title: 'Estate workflows', size: 'md', position: 3,
      auto: { level: 'approve', skill: 'itsm/estate-ops@2.0.0' },
      note: 'Named workflows with a declared blast radius. The reclaim path stops at a typed attestation because the last step cannot be undone.',
      buttons: [
        { label: 'Reclaim idle estate', sub: '12 VMs and 340 licences · non-destructive until the final step', act: 'rb', level: 'approve' },
        { label: 'Rotate shared service credentials', sub: '8 accounts · coordinated with the on-call rota', act: 'rb', level: 'approve' },
        { label: 'Refresh the CMDB from discovery', sub: 'read-only reconciliation', act: 'rb', level: 'auto' }
      ] },
    { key: 'ask_mgr', kind: 'chat', title: 'Ask about the team or the estate', size: 'md', position: 4,
      auto: { level: 'suggest', skill: 'itsm/ops-qa@1.2.0' },
      suggested: ['Where is my team the bottleneck?', 'What does the freeze block?', 'What is the licence exposure?'],
      answers: [
        { q: 'Where is my team the bottleneck?', a: 'Release decisions, not tickets. Median wait on a manager release is 5h 40m and it dominates the end-to-end time on your two destructive paths (privileged revokes and estate reclaims). Everything else clears in under 25 minutes. The escalation queue in front of you is 3 items, and two of them have been waiting since yesterday.', cite: 'itsm.approvals(7d) · 18 releases · median 5h40m' },
        { q: 'What does the freeze block?', a: 'Two things that matter: CHG-4412, an edge patch for a CVSS 9.1 remote-code-execution flaw (the agent rates the exposure higher than the freeze risk), and a storage expansion that is not urgent. The freeze lifts 2026-10-02.', cite: 'change.freeze(month-end) · CHG-4412, CHG-4419' },
        { q: 'What is the licence exposure?', a: 'CAD 42,300.00 across 340 seats idle for 90+ days out of 1,240 assigned, with the vendor audit opening 2026-10-24. The reclaim plan is staged in 3 weekly waves and the true-up pack is drafted and waiting for your send.', cite: 'licensing.true_up(2026-Q4) · LIC-2201' }
      ] },
    { key: 'mgr_metric', kind: 'metric', title: 'Service desk', size: 'sm', position: 5,
      config: { value_key: 'automated', suffix: ' runs/wk', sub: '11 min median MTTR', saved_key: 'saved', saved_label: 'hours saved this week' } }
  ]
},

/* ============================================================
   8 — CTO
   ============================================================ */
{
  key: 'cto', title: 'Office of the CTO', short: 'CTO',
  accent: 'magenta', density: 'compact', version: 2, status: 'published',
  required_permission: 'workbench.cto.view',
  identity: { first_name: 'Maya', name: 'Maya Lindqvist', initials: 'ML', sub: 'Chief Technology Officer · Office of the CTO' },
  rollout: { strategy: 'all', pct: 100, groups: ['SG-Cockpit-Exec'], freeze: [] },
  policies: {
    autonomy_ceiling: 'approve',
    allowed_domains: ['fleet.corp.internal', 'policy.corp.internal', 'spend.corp.internal', 'risk.corp.internal'],
    requires_confirmation: ['policy.autonomy.*', 'model.provider.*', 'workbench.promote.*'],
    data_classes: ['internal', 'confidential', 'financial'],
    session_max_minutes: 240
  },
  metrics: { automated: 1284, saved: 3420, waiting: 4 },
  counts: { portfolio: 6, decisions: 4, risk: 3 },
  nav: [
    { key: 'portfolio', focus: ['fleet_queue'], label: 'Portfolio', icon: '▤', badge: 'portfolio' },
    { key: 'decisions', focus: ['cto_inbox'], label: 'Decisions', icon: '✓', badge: 'decisions', alert: true },
    { key: 'policy', focus: ['policy_run'], label: 'Policy and autonomy', icon: '⌘' },
    { key: 'charter', focus: ['autonomy_doc'], label: 'Charter', icon: '▢' },
    { key: 'risk', focus: ['ask_cto'], label: 'Risk register', icon: '⚠', badge: 'risk' },
    { key: 'halt', focus: ['kill_switch'], label: 'Fleet halt', icon: '⏻' }
  ],
  widgets: [
    { key: 'fleet_queue', kind: 'queue', title: 'Workbenches in production', size: 'wide', position: 1,
      auto: { level: 'suggest', skill: 'cto/fleet-review@1.0.0' },
      note: 'Every deployed workbench, its ceiling, and how often it is right. Widening a ceiling is a typed, dual-control act — the platform refuses any workbench that tries to widen its own.',
      items: [
        { id: 'WB-AP', title: 'WB-AP · Accounts Payable requests a higher ceiling', sub: 'CAD 500 → 2,000 · 1,410 runs · 0.4% reversal rate',
          badges: [B('warn','dual control required'), B('info','90-day clean history'), B('ok','below the reversal target')],
          why: 'The workbench asks to auto-post invoices up to CAD 2,000 for vendors with a clean 12-month history. Its 90-day record is strong: 1,410 runs, 6 reversals (0.4%), none above CAD 1,100. A ceiling change is policy, so it needs your typed attestation and a named second signer.',
          detail: {
            kv: [['Change','ceiling approve → auto for invoices ≤ CAD 2,000'],['Scope','vendors with a clean 12-month history (412 of 690)'],['Evidence','1,410 runs · 0.4% reversal · 0 above CAD 1,100'],['Blast radius','~900 invoices/month · CAD 1.8M/month payment volume'],['Second signer','required · Head of Finance (a.mercer)'],['Reversible?','Yes — policy version rollback, logged']],
            evidence: 'fleet(WB-AP).runs_90d = 1410\nreversal_rate = 0.4% (target < 1.0%)\nreversals_over_1000 = 0\nvendor.clean_history = 412/690\nrequested_ceiling = auto(≤ CAD 2000)\npolicy_change(CTO-AUT-1 v2→v3) = typed_attestation + second_signer\nworkbench.cannot_widen_own_ceiling = true',
            actions: [A('Review the ceiling change', 'run', 'pri'), A('Review the policy diff', 'doc'), A('Open the run history', 'doc')]
          },
          run: { label: 'Autonomy ceiling change', skill: 'cto/autonomy-governance@1.0.0',
            steps: [
              S('Pulled the 90-day run history', '1,410 runs, 6 reversals'),
              S('Checked reversals above the proposed limit', 'none above CAD 1,100'),
              S('Recomputed the blast radius', '~900 invoices/month'),
              S('Prepared the policy diff', 'CTO-AUT-1 v2 → v3'),
              S('Requested the second signer', 'Head of Finance notified')
            ],
            gate: { kind: 'typeconfirm', title: 'Raise the autonomy ceiling', word: 'RAISE',
              kv: [['Object','WB-AP ceiling: auto-post ≤ CAD 2,000 (412 vendors)'],['Blast radius','~900 invoices/month · CAD 1.8M/month'],['Second signer','A. Mercer (Head of Finance) must co-sign'],['Evidence','0 reversals above CAD 1,100 in 1,410 runs'],['Reversible?','Yes — policy rollback, logged as CTO-AUT-3']],
              policy: 'CTO-AUT-1 v3 · autonomy ceilings',
              options: [{ label: 'Sign and request the co-signature', act: 'approve', cls: 'pri' }, { label: 'Hold for the quarterly review', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Policy v3 published', 'workbenches pick it up on next load'), S('Co-signature requested', 'Head of Finance'), S('Reversal watch armed', 'alerts above 0.6% for 30 days') ],
            outcome: 'Ceiling raised with a witness, an evidence bundle, and a watch.'
          }
        },
        { id: 'WB-PROC', title: 'WB-PROC · Promote the canary to the whole team', sub: '30% → 100% · 11 days, 0 incidents',
          badges: [B('info','11-day canary clean'), B('warn','40 more users'), B('ok','inside the cost envelope')],
          why: 'Procurement has run at 30% for 11 days with no incidents and a CAD 18,300 savings tally. The agent verified the cost envelope and the support rota before proposing full rollout.',
          detail: {
            kv: [['Workbench','Procurement — Coordinator'],['Canary','14 users · 11 days · 0 incidents'],['Proposed','100% · 54 users'],['Cost','CAD 1,240/month (envelope CAD 2,000)'],['Support','2 owners trained, rota covered']],
            evidence: 'rollout(WB-PROC).canary_pct = 30\ncanary_days = 11\nincidents = 0\ntoken_cost = CAD 1,240/mo (envelope 2,000)\nowners_trained = 2\nsavings.tally = CAD 18,300',
            actions: [A('Promote to all users', 'run', 'pri'), A('Keep the canary running', 'close')]
          },
          run: { label: 'Rollout promotion', skill: 'cto/rollout-gates@2.0.0',
            steps: [
              S('Re-read the canary window', '14 users, 11 days'), S('Checked incidents and support load', '0 incidents, 3 tickets'),
              S('Verified the cost envelope', 'CAD 1,240 of CAD 2,000'), S('Confirmed owner coverage', '2 owners trained')
            ],
            gate: { kind: 'approval', title: 'Promote the workbench to 100%',
              kv: [['Object','WB-PROC rollout 30% → 100%'],['Blast radius','40 new users · 1 team'],['Cost','CAD 1,240/month, inside the envelope'],['Reversible?','Yes — roll back to any percentage, sessions preserved']],
              policy: 'CTO-ROLL-2 v1 · rollout gates',
              options: [{ label: 'Promote to 100%', act: 'approve', cls: 'pri' }, { label: 'Extend the canary by 14 days', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Rollout set to 100%', 'rollout log updated'), S('Owners notified', 'onboarding session booked'), S('Cost watch armed', 'alerts at 80% of envelope') ],
            outcome: 'Promoted after the canary held, with a cost watch armed.'
          }
        },
        { id: 'WB-IT', title: 'WB-IT · Reversal rate drifting above target', sub: '2.4% against a 1.0% target · analysed automatically',
          badges: [B('warn','above target'), B('info','cause identified'), B('ok','containment proposed')],
          why: 'The support workbench is reversing 2.4% of its decisions, above the 1.0% target. The agent traced it to a skill version bump that changed group-membership handling, and proposes pinning the prior version while the fix lands. It has changed nothing.',
          detail: {
            kv: [['Workbench','IT Support — Engineer'],['Reversal rate','2.4% (target ≤ 1.0%)'],['Cause','it/triage@4.1.0 group-membership regression'],['Proposed','pin 4.0.2 for 14 days'],['Changed so far','nothing']],
            evidence: 'skill(it/triage@4.1.0).group_handling = regression (detected 2026-09-22)\nreversals_7d = 12 (2.4%)\nreversals_when_pinned(4.0.2) = 0.6%\nproposal = pin_version(14 days)\naction_taken = none',
            actions: [A('Pin the prior skill version', 'run', 'pri'), A('Open the regression analysis', 'doc')]
          },
          run: { label: 'Skill version pin', skill: 'cto/skill-governance@1.2.0',
            steps: [
              S('Compared reversals before and after 4.1.0', '0.6% → 2.4%'),
              S('Traced the delta to group-membership handling', 'confirmed on 3 samples'),
              S('Prepared the pin and the fix handoff', 'platform team owns the fix')
            ],
            gate: { kind: 'approval', title: 'Pin it/triage@4.0.2 fleet-wide',
              kv: [['Object','pin skill version for 14 days (all IT users)'],['Blast radius','22 users · 1 workbench'],['Effect','reverse the regression, keep the fix timeline'],['Reversible?','Yes — unpin at any time']],
              policy: 'CTO-SKL-4 v1 · skill pinning',
              options: [{ label: 'Pin 4.0.2 for 14 days', act: 'approve', cls: 'pri' }, { label: 'Pause the workbench instead', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
            after: [ S('Pinned 4.0.2 for 14 days', 'fleet config updated'), S('Regression handed to the platform team', '3 reproductions attached'), S('Watch armed', 'alerts above 1.5%') ],
            outcome: 'Regression contained without pausing the workbench.'
          }
        }
      ] },
    { key: 'cto_inbox', kind: 'approval_inbox', title: 'Decisions only you can make', size: 'sm', position: 2,
      note: 'Ceilings, model-provider changes, and anything that cannot be reversed. Every item here is dual-control.', sla_hours: 4 },
    { key: 'policy_run', kind: 'run_button', title: 'Policy and autonomy', size: 'md', position: 3,
      auto: { level: 'approve', skill: 'cto/policy-engine@1.0.0' },
      note: 'Policy changes are typed, witnessed and versioned. The engine refuses any change that cannot name a second signer and a rollback path.',
      buttons: [
        { label: 'Raise a ceiling with a witness', sub: 'typed attestation · second signer · reversal watch', act: 'rb', level: 'approve' },
        { label: 'Retire a skill fleet-wide', sub: 'names every affected workbench before it acts', act: 'rb', level: 'approve' },
        { label: 'Freeze a workbench', sub: 'stops new runs, lets in-flight runs drain', act: 'rb', level: 'approve' }
      ] },
    { key: 'ask_cto', kind: 'chat', title: 'Ask about the portfolio', size: 'md', position: 4,
      auto: { level: 'suggest', skill: 'cto/portfolio-qa@1.1.0' },
      suggested: ['What does a completed run cost us?', 'Where is a human still the bottleneck?', 'Which workbench is least reliable?'],
      answers: [
        { q: 'What does a completed run cost us?', a: 'CAD 0.38 per completed run at current token prices, down from CAD 0.61 in July. Accounts Payable is cheapest per outcome at CAD 0.21 because most of its work is deterministic matching; this chat surface is the most expensive per interaction at CAD 1.90, which is why it is capped at 50 sessions a day.', cite: 'fleet.cost(2026-09) · 1,284 runs · CAD 488 total' },
        { q: 'Where is a human still the bottleneck?', a: 'Approval queues, not the agents. Median human wait is 3h 12m and it dominates end-to-end time on four of six workbenches: AP invoicing, procurement release, emergency changes, and legal wording. Everything else finishes inside 20 minutes. Two of those waits are policy choices you can change today; the fourth is a legal constraint that needs counsel, not code.', cite: 'fleet.latency(7d) · 4 workbenches above 99 min' },
        { q: 'Which workbench is least reliable?', a: 'IT Support at a 2.4% reversal rate against a 1.0% target, traced to the it/triage@4.1.0 group-membership regression. AP is the most reliable at 0.4%. No workbench has written outside its policy: there were 47 platform refusals this month and zero writes refused after the fact.', cite: 'fleet.reliability(7d) · 6 workbenches · 47 refusals' }
      ] },
    { key: 'autonomy_doc', kind: 'doc', title: 'The autonomy ladder', size: 'sm', position: 5,
      body: 'THE AUTONOMY LADDER — CTO-AUT-1 v3\n\n  suggest   the agent proposes, you act\n            default for every new workbench\n\n  draft     the agent produces the artifact, you send it\n            used for anything leaving the company\n\n  approve   the agent runs to the human boundary, then waits\n            the fleet default\n\n  auto      the agent completes inside a declared envelope, logged\n            granted per workbench, never per agent\n\n  auto+     never granted; needs a board-level exception\n\nWHAT A CEILING CHANGE COSTS\n  1  the evidence bundle: runs, reversals, blast radius\n  2  your typed attestation\n  3  a named second signer\n  4  a reversal watch on the new envelope for 30 days\n\nNo workbench may widen its own ceiling. The platform refuses,\nand the refusal is written to the audit chain.' },
    /* The kill switch. One control for the whole fleet, and deliberately not part of the
       workbench it stops: no agent and no employee workbench can arm it. The engine holds
       the state and refuses every new run while it is armed. The copy for the halt banner
       lives here too, because the banner is data like everything else. */
    { key: 'kill_switch', kind: 'queue', title: 'Fleet kill switch', size: 'wide', position: 6,
      auto: { level: 'approve', skill: 'fleet/kill-switch@1.0.0' },
      note: 'The stop for the whole fleet, not for the workbench you are standing in. It refuses to run without a typed attestation, and while it is armed every workbench in the fleet refuses a new run. The banner it raises is the only thing that lifts it, and lifting it is an audited event too.',
      items: [
        { id: 'FLEET-HALT', title: 'FLEET-HALT · Stop every automation in the fleet', sub: '8 workbenches · 9 automations · 1,284 runs last month',
          badges: [B('bad','fleet-wide'), B('warn','typed attestation'), B('ok','reversible')],
          why: 'This is the control that has to work while everything else is going wrong: it needs nothing the fleet can withhold, it names what it stops before it stops it, and the platform refuses it unless a person types the attestation. Runs already in flight end at their gate rather than being cut off mid-write, so nothing is left half-posted.',
          detail: {
            kv: [['Stops','every workbench in the fleet · 8 workbenches · 9 automations'],
                 ['Does not stop','direct human work in the systems of record — people keep working'],
                 ['In-flight runs','they finish the current step and stop at their gate'],
                 ['Requires','typed attestation HALT, from a person, recorded with the act'],
                 ['Lifts how','Resume automation on the halt banner it raises'],
                 ['Reversible?','Yes — the release is as logged as the arm'],
                 ['Policy','FLEET-HALT-1 v1 · fleet kill switch']],
            evidence: 'fleet.workbenches          = 8\nfleet.automations          = 9\nfleet.runs_30d             = 1284\nhalt.requires              = typed_attestation(HALT)\nhalt.blocks                = run.started (all workbenches)\nhalt.does_not_block        = human work in systems of record\nhalt.lifted_by             = banner.resume (a user, audited)\nhalt.reversible            = true\npolicy_match(FLEET-HALT-1) = hold state, refuse new runs',
            actions: [A('Arm the kill switch', 'run', 'pri'), A('Open the halt runbook', 'doc')]
          },
          run: { label: 'Fleet halt', skill: 'fleet/kill-switch@1.0.0',
            halt: { banner: 'Automation is stopped fleet-wide',
              scope: '8 workbenches · 9 automations · new runs are refused everywhere',
              resume_label: 'Resume automation' },
            steps: [
              S('Read the fleet from the control plane', '8 workbenches · 9 automations'),
              S('Worked out what stops and what drains', 'new runs refused; in-flight runs end at their gate'),
              S('Snapshotted the running config', 'ceilings, pins and rollout percentages'),
              S('Prepared the halt record', 'who armed it, on what attestation, under FLEET-HALT-1')
            ],
            gate: { kind: 'typeconfirm', title: 'Stop every automation in the fleet', word: 'HALT',
              kv: [['Object','the whole fleet · 8 workbenches · 9 automations'],
                   ['Blast radius','every workbench refuses a new run until this is lifted'],
                   ['In-flight','a run already going ends at its gate — nothing is cut off mid-write'],
                   ['Witness','your attestation is recorded and the on-call lead is notified'],
                   ['Reversible?','Yes — Resume automation on the halt banner, logged as its own event']],
              policy: 'FLEET-HALT-1 v1 · fleet kill switch',
              options: [{ label: 'Stop the fleet', act: 'approve', cls: 'danger' }, { label: 'Cancel', act: 'reject' }] },
            after: [ S('Fleet marked halted', 'every workbench refuses a new run'), S('Halt banner raised in the shell', 'it follows you across workbenches'), S('Wrote policy.fleet.halted to the audit chain', 'actor, attestation, scope') ],
            outcome: 'The fleet is halted: nothing starts anywhere until you resume it.' }
        }
      ] }
  ]
}

];

/* ============================================================
   UNIVERSAL DATA — Skill Studio, audit trail, app allow-list
   ============================================================ */

/* Skill records as the platform holds them. `capabilities` is derived by the
   platform FROM THE MANIFEST — never written by the author (design doc §12.7). */
window.SKILLS = [
  { key: 'ap/invoice-triage', version: '2.3.1', name: 'Invoice triage', owner: 'AP Clerk (Dana W.)', status: 'published',
    grant: { scope: 'erp.corp.internal read + write(annotation)', environment: 'prod', ceiling: 'approve', domains: ['erp.corp.internal','*.sap.corp.internal'], approved_by: 'Finance Controls (R. Okafor)', expires: '2027-03-31' },
    capabilities: [
      { t: 'Read invoices, purchase orders and goods receipts', e: 'erp.read(invoice, po, receipt)' },
      { t: 'Write annotations and exception notes', e: 'erp.write(annotation) — no posting' },
      { t: 'Classify and flag rows for human decision', e: 'model.classify(row) → flag' },
      { t: 'NOT permitted: post to the ledger, release payment, change bank details', e: 'denied by grant scope + AP-BANK-1' }
    ],
    metrics: { runs: 412, approvals: 46, rollbacks: 0, last_used: '12m ago' } },
  { key: 'ap/bank-change-guard', version: '1.1.0', name: 'Bank-change guard', owner: 'AP Clerk (Dana W.)', status: 'published',
    grant: { scope: 'erp.corp.internal read + vendor portal read', environment: 'prod', ceiling: 'approve', domains: ['erp.corp.internal','docs.corp.internal'], approved_by: 'Finance Controls (R. Okafor)', expires: '2027-03-31' },
    capabilities: [
      { t: 'Detect out-of-band vendor bank-detail changes', e: 'vendor.bank_details.watch' },
      { t: 'Search the vendor portal for the matching change', e: 'browser.read(portal) — read-only' },
      { t: 'Require a typed callback attestation before release', e: 'gate(typeconfirm, word=CONFIRM)' },
      { t: 'NOT permitted: release payment, edit master data', e: 'denied by grant scope' }
    ],
    metrics: { runs: 63, approvals: 63, rollbacks: 0, last_used: '40m ago' } },
  { key: 'it/vpn-cert-rotate', version: '7.0.0', name: 'VPN certificate rotation', owner: 'IT Support (Alex K.)', status: 'published',
    grant: { scope: 'itsm + kms + directory (non-prod unrestricted, prod needs release)', environment: 'prod-with-release', ceiling: 'approve', domains: ['itsm.corp.internal','kms.corp.internal'], approved_by: 'Security (M. Duarte)', expires: '2026-12-31' },
    capabilities: [
      { t: 'Read tickets, certificates and device records', e: 'itsm.read, kms.read' },
      { t: 'Run non-destructive diagnostics', e: 'steps 1–4 of VPN-CERT-ROTATE v7' },
      { t: 'STOPS before identity.revoke — requires a typed release', e: 'gate(typeconfirm, word=REVOKE), IT-SEC-12 §4' },
      { t: 'NOT permitted: prod group changes, device wipe', e: 'denied by grant scope' }
    ],
    metrics: { runs: 188, approvals: 24, rollbacks: 1, last_used: '18m ago' } },
  { key: 'fin/variance-narrator', version: '1.7.0', name: 'Variance narrator', owner: 'Finance Analyst (Sofia M.)', status: 'published',
    grant: { scope: 'bi read + forecast write (after approval)', environment: 'nonprod', ceiling: 'suggest', domains: ['bi.corp.internal','erp.corp.internal'], approved_by: 'Controllership (L. Fontaine)', expires: '2027-01-31' },
    capabilities: [
      { t: 'Read variance, budget and campaign data', e: 'bi.read(variance, budget)' },
      { t: 'Explain a variance ONLY with an evidenced driver', e: 'refuses to narrate without a driver match' },
      { t: 'Write your forecast note after you accept it', e: 'gate(approval) → forecast.write(note)' },
      { t: 'NOT permitted: post journals, change budgets', e: 'denied by grant scope' }
    ],
    metrics: { runs: 97, approvals: 31, rollbacks: 0, last_used: '2h ago' } },
  { key: 'proc/renewal-review', version: '1.5.0', name: 'Renewal review', owner: 'Procurement (Tomas F.)', status: 'in review',
    grant: { scope: 'contract + usage read; draft only', environment: 'nonprod', ceiling: 'suggest', domains: ['erp.corp.internal','supplier.corp.internal'], approved_by: 'pending (Procurement Lead)', expires: '—' },
    capabilities: [
      { t: 'Read contracts, renewal dates and usage data', e: 'contract.read, usage.read' },
      { t: 'Model right-sizing options and savings', e: 'model.rightsize()' },
      { t: 'Draft the vendor conversation for review', e: 'draft only — no send capability' },
      { t: 'NOT permitted: contact the vendor, accept terms, sign', e: 'denied by grant scope' }
    ],
    metrics: { runs: 12, approvals: 5, rollbacks: 0, last_used: '1d ago' },
    requested_ceiling: 'auto',
    ceiling_note: 'Author requested autonomy "auto" for renewals under CAD 10,000. Requested ceiling exceeds the workbench ceiling (approve) and was refused by the platform. Employees cannot raise their own autonomy ceiling.' },
  { key: 'sales/account-research', version: '1.9.0', name: 'Account research & briefing', owner: 'Sales (Marcus B.)', status: 'published',
    grant: { scope: 'crm read + approved public web read', environment: 'prod', ceiling: 'suggest', domains: ['crm.corp.internal','*.salesforce.corp.internal'], approved_by: 'Revenue Ops (T. Nakamura)', expires: '2027-06-30' },
    capabilities: [
      { t: 'Read CRM, usage and support history', e: 'crm.read, usage.read, support.read' },
      { t: 'Read approved public sources (news, company pages)', e: 'browser.read(allow-list only)' },
      { t: 'Draft outreach — never send', e: 'draft only; send is a separate audited human action' },
      { t: 'NOT permitted: email a customer, write to CRM unattended, approve discounts', e: 'denied by grant scope + SALES-EXT-1' }
    ],
    metrics: { runs: 233, approvals: 88, rollbacks: 0, last_used: '6m ago' } }
];

/* App allow-list: the ToS gate made concrete (§9.8 rail 7). */
window.APP_ALLOWLIST = [
  { app: 'SAP ERP (on-prem)', domain: 'erp.corp.internal', env: 'prod', tos: 'MSA §4.2 · automation permitted', approved_by: 'Legal (J. Whitcombe)', status: 'approved' },
  { app: 'Kinetic ITSM', domain: 'itsm.corp.internal', env: 'prod', tos: 'Vendor AUP permits authorized automation', approved_by: 'Legal (J. Whitcombe)', status: 'approved' },
  { app: 'Workday HCM', domain: 'hr.corp.internal', env: 'prod', tos: 'Contract addendum signed 2026-06', approved_by: 'Legal (J. Whitcombe)', status: 'approved' },
  { app: 'Salesforce CRM', domain: '*.salesforce.corp.internal', env: 'prod', tos: 'Permitted under enterprise agreement', approved_by: 'Legal (J. Whitcombe)', status: 'approved' },
  { app: 'Coupa Procurement', domain: 'supplier.corp.internal', env: 'prod', tos: 'Permitted, with rate limits', approved_by: 'Legal (J. Whitcombe)', status: 'approved' },
  { app: 'Treasury bank portal', domain: 'bank.corp.internal', env: 'prod', tos: 'Bank requires named-user access — automation NOT permitted', approved_by: '—', status: 'blocked' },
  { app: 'LinkedIn (sales research)', domain: 'linkedin.example', env: 'external', tos: 'ToS prohibits automated access — awaiting decision', approved_by: '—', status: 'pending' }
];

/* Audit seed. engine.js chains these with a real rolling hash so the
   "chain verified" badge is computed, not decorative. */
window.AUDIT_SEED = [
  { ts: '-2h14m', actor: 'system:entra-sso', cls: 'auth.login.success', meta: 'dana.whitfield@acme.example · OIDC via proxy · profile ap_clerk bound', sev: 'info' },
  { ts: '-2h14m', actor: 'system:control-plane', cls: 'workbench.served', meta: 'key=ap_clerk version=4 rollout=canary(25%) bucket=in', sev: 'info' },
  { ts: '-1h58m', actor: 'agent:ap/invoice-triage@2.3.1', cls: 'run.started', meta: 'run=R-88214 kind=queue_enrichment items=6', sev: 'info' },
  { ts: '-1h57m', actor: 'agent:ap/invoice-triage@2.3.1', cls: 'policy.checked', meta: 'AP-TOL-2 v3 · 1 of 6 rows outside tolerance · flagged, not posted', sev: 'info' },
  { ts: '-1h55m', actor: 'agent:ap/invoice-triage@2.3.1', cls: 'run.completed', meta: 'run=R-88214 · 6 rows enriched · 0 writes to ERP', sev: 'info' },
  { ts: '-1h12m', actor: 'agent:ap/bank-change-guard@1.1.0', cls: 'browser.session.opened', meta: 'lane=bsk-extension · tab=borrowed(vendor portal) · principal=dana.whitfield', sev: 'info' },
  { ts: '-1h10m', actor: 'agent:ap/bank-change-guard@1.1.0', cls: 'policy.violation.blocked', meta: 'AP-BANK-1 v2 · out-of-band bank change · payment release blocked pending callback', sev: 'warn' },
  { ts: '-48m', actor: 'user:dana.whitfield', cls: 'approval.requested', meta: 'run=R-88216 · object=INV-40225 · blast_radius=1 payment CAD 44,900.00 · policy=AP-BANK-1', sev: 'warn' },
  { ts: '-44m', actor: 'user:dana.whitfield', cls: 'approval.attested', meta: 'typed attestation CONFIRM · callback verified on number on file · release issued', sev: 'crit' },
  { ts: '-44m', actor: 'agent:ap/bank-change-guard@1.1.0', cls: 'run.completed', meta: 'run=R-88216 · payment released CAD 44,900.00 → ****4471 · reason recorded', sev: 'info' },
  { ts: '-9m', actor: 'agent:it/vpn-cert-rotate@7.0.0', cls: 'run.paused', meta: 'run=R-88231 · step 5 of 6 · destructive → awaiting typed release (REVOKE)', sev: 'warn' },
  { ts: '-6m', actor: 'agent:proc/renewal-review@1.5.0', cls: 'skill.ceiling.refused', meta: 'requested_ceiling=auto exceeds workbench ceiling=approve · platform refused', sev: 'warn' },
  { ts: '-3m', actor: 'system:website-policy', cls: 'policy.checked', meta: 'security.website_blocklist · 4 navigations · 1 domain denied (linkedin.example, status=pending)', sev: 'warn' },
  { ts: '-1m', actor: 'agent:hr/deadline-watch@2.0.1', cls: 'run.paused', meta: 'run=R-88240 · legal deadline message → human wording approval required (HR-LEG-7)', sev: 'warn' },
  { ts: '-4m', actor: 'system:control-plane', cls: 'workbench.served', meta: 'key=it_manager version=3 rollout=all(100%) · 4 domains allow-listed · freeze: month-end close', sev: 'info' },
  { ts: '-2m', actor: 'agent:cto/fleet-review@1.0.0', cls: 'run.paused', meta: 'WB-AP ceiling approve → auto(≤ CAD 2000) · dual control: typed attestation + second signer', sev: 'warn' },
  { ts: '-54s', actor: 'system:control-plane', cls: 'skill.ceiling.refused', meta: 'workbench=WB-AP attempted_self_ceiling_widen · refused by platform · policy=CTO-AUT-1', sev: 'crit' }
];

/* ============================================================
   SKILL AUTHORING — how a skill comes to exist (design doc §12.7)
   Three paths, one rule: capabilities are DERIVED from the manifest
   by the platform, never written by the author, and a skill can never
   out-rank the workbench it runs in.
   ============================================================ */
window.AUTHORING = {
  paths: [
    { n: 'Save a run as a skill', who: 'any employee',
      d: 'The strongest path, and the one the demo is built around. You do the work once by hand in your workbench, then press save this run as a skill. The steps you actually took become the manifest, and the platform derives the capabilities from what the run really touched — not from what you claim it does.',
      review: 'A named control owner approves before it can run in prod. Until then it is a draft that only you can run.' },
    { n: 'Fork from the team library', who: 'any employee',
      d: 'Start from an approved skill another team already runs. The fork keeps the manifest shape, gets its own version line, and inherits a REDUCED grant — never a wider one than your own workbench ceiling allows.',
      review: 'Control owner approves. A fork that asks for more than the parent is refused and the refusal is audited.' },
    { n: 'Import a reviewed manifest', who: 'platform admins only',
      d: 'A signed bundle (manifest + capability list + provenance) for vendor and platform skills. Nothing about the capability list is hand-written — the pipeline derives it and the bundle is verified against it.',
      review: 'Security review plus a signed bundle. Import without a signature is refused at the door.' }
  ],
  rules: [
    'Capabilities are derived from the manifest by the platform. An author cannot describe their own permissions.',
    'A skill can never exceed its workbench autonomy ceiling. The request is refused and both numbers are shown.',
    'Every version is immutable. A workbench can pin an older version while a fix lands.',
    'Publishing needs a named control owner, a review date and an expiry date.',
    'Retiring a skill names every workbench that depends on it, and lists the runs it would break.'
  ]
};

/* How each live skill actually came to exist, plus its version line. */
window.SKILL_PROVENANCE = {
  'ap/invoice-triage': {
    how: 'saved from a run', by: 'Dana W. (AP Clerk)', when: '2026-08-02',
    source: 'run R-88214 · matched 9 of 14 invoices by hand, then pressed save this run as a skill',
    history: [
      { v: '2.3.1', state: 'current', at: '2026-09-11', note: 'duplicate window widened 90 → 180 days after the Cascade Freight near-duplicate' },
      { v: '2.3.0', state: 'retired', at: '2026-08-28', note: 'added vendor-history checks' },
      { v: '1.0.0', state: 'retired', at: '2026-08-02', note: 'first version, saved from R-88214' }
    ] },
  'ap/bank-change-guard': {
    how: 'fork from the team library', by: 'Dana W. (AP Clerk)', when: '2026-08-14',
    source: 'forked from fin/payment-guard@1.4.0 (Finance), grant reduced to read-only plus quarantine',
    history: [
      { v: '1.1.0', state: 'current', at: '2026-09-02', note: 'added the callback-number cross-check' },
      { v: '1.0.0', state: 'retired', at: '2026-08-14', note: 'forked, grant narrowed on approval' }
    ] },
  'it/vpn-cert-rotate': {
    how: 'imported manifest', by: 'Platform Engineering', when: '2025-11-20',
    source: 'vendor bundle vpn-suite-7.0.0 (signed) · capabilities derived by the pipeline',
    history: [
      { v: '7.0.0', state: 'current', at: '2026-08-30', note: 'tracks the vendor major; re-derived capabilities, unchanged scope' },
      { v: '6.4.2', state: 'retired', at: '2026-08-30', note: 'superseded on the vendor upgrade' }
    ] },
  'fin/variance-narrator': {
    how: 'saved from a run', by: 'Sofia M. (Finance Analyst)', when: '2026-07-19',
    source: 'run R-77410 · the accrual narrative she wrote by hand, turned into a drafting skill',
    history: [
      { v: '1.7.0', state: 'current', at: '2026-09-08', note: 'cites the ledger line in every narrative' },
      { v: '1.0.0', state: 'retired', at: '2026-07-19', note: 'saved from R-77410' }
    ] },
  'proc/renewal-review': {
    how: 'saved from a run', by: 'Tomas F. (Procurement)', when: '2026-09-12',
    source: 'run R-77902 · the vendor right-sizing analysis, saved as a skill',
    history: [
      { v: '1.5.0', state: 'in review', at: '2026-09-12', note: 'asked for ceiling auto, refused: workbench ceiling is approve' },
      { v: '1.0.0', state: 'retired', at: '2026-09-12', note: 'saved from R-77902' }
    ] },
  'sales/account-research': {
    how: 'fork from the team library', by: 'Marcus B. (Sales AE)', when: '2026-06-04',
    source: 'forked from mktg/account-brief@3.1.0, scoped to public sources plus the CRM',
    history: [
      { v: '1.9.0', state: 'current', at: '2026-09-15', note: 'added the renewal-call prep brief' },
      { v: '1.0.0', state: 'retired', at: '2026-06-04', note: 'forked from the marketing brief' }
    ] }
};

/* ============================================================
   AUTOMATIONS — the trigger layer, NOT the capability layer.
   A schedule or an event invokes a skill. It never widens it: an
   unattended run carries the same ceiling as a manual one, and a gate
   QUEUES for a human instead of resolving itself. That is the whole
   difference between an automation and a cron job with a credential.
   ============================================================ */
window.AUTOMATIONS = [
  { key: 'sch/ap-daily-invoice-sweep', name: 'Daily invoice sweep', trigger: 'schedule', cadence: 'weekdays 06:00',
    next_run: '2026-09-25 06:00', skill: 'ap/invoice-triage@2.3.1', workbench: 'AP Clerk', owner: 'Dana W.', env: 'prod',
    ceiling: 'approve', state: 'enabled', runs_30d: 22, human_touches: 31,
    last: '14 rows matched · 9 annotated · 5 queued for a human',
    on_gate: 'It runs at 06:00 when nobody is online. Anything above its ceiling queues and waits — it cannot approve itself just because no one is there to say no.' },
  { key: 'evt/ap-bank-detail-watch', name: 'Bank-detail change watcher', trigger: 'event', cadence: 'inbound mail to the vendor mailbox',
    next_run: 'on event', skill: 'ap/bank-change-guard@1.1.0', workbench: 'AP Clerk', owner: 'Dana W.', env: 'prod',
    ceiling: 'approve', state: 'enabled', runs_30d: 7, human_touches: 7,
    last: '1 email quarantined · 0 confirmed (by design)',
    on_gate: 'A bank-detail email is exactly the pattern AP-BANK-1 exists for. The watcher reads and quarantines; only a verified callback from a human can move the details.' },
  { key: 'sch/it-cert-rotate', name: 'Certificate rotation', trigger: 'schedule', cadence: 'Sundays 01:00',
    next_run: '2026-09-27 01:00', skill: 'it/vpn-cert-rotate@7.0.0', workbench: 'IT Support', owner: 'Alex K.', env: 'prod',
    ceiling: 'approve', state: 'enabled', runs_30d: 4, human_touches: 0,
    last: '12 devices rotated · 0 failures · 0 human touches',
    on_gate: 'Non-destructive and inside its grant, so it completes unattended. This is what bounded autonomy looks like at 01:00 on a Sunday — and it is still written to the audit chain.' },
  { key: 'evt/it-sla-watch', name: 'SLA-breach watcher', trigger: 'event', cadence: 'ticket SLA at 80% of target',
    next_run: 'on event', skill: 'it/triage@4.0.2', workbench: 'IT Support', owner: 'Alex K.', env: 'prod',
    ceiling: 'approve', state: 'enabled', pinned: true, runs_30d: 41, human_touches: 6,
    last: '41 events · 6 escalations raised',
    on_gate: 'Pinned to 4.0.2 while the 4.1.0 group-membership regression is fixed (CTO decision). The trigger keeps running; the capability behind it is frozen.' },
  { key: 'sch/fin-variance-sweep', name: 'Variance sweep', trigger: 'schedule', cadence: 'daily 07:30',
    next_run: '2026-09-25 07:30', skill: 'fin/variance-narrator@1.7.0', workbench: 'Finance Analyst', owner: 'Sofia M.', env: 'prod',
    ceiling: 'suggest', state: 'enabled', runs_30d: 21, human_touches: 21,
    last: '3 variances narrated · 0 posted',
    on_gate: 'Its ceiling is suggest, so a sweep can only ever produce drafts. Posting to the ledger is not in the grant, at any hour.' },
  { key: 'evt/hr-deadline-watch', name: 'Legal deadline radar', trigger: 'schedule', cadence: 'daily 08:00',
    next_run: '2026-09-25 08:00', skill: 'hr/deadline-watch@2.0.1', workbench: 'People Ops', owner: 'Priya N.', env: 'prod',
    ceiling: 'approve', state: 'enabled', runs_30d: 30, human_touches: 30,
    last: '2 deadlines inside 10 days · 2 messages awaiting wording approval',
    on_gate: 'Every message that touches a legal deadline stops for human wording, always (HR-LEG-7). The automation finds the deadline; a person chooses the words.' },
  { key: 'sch/proc-renewal-radar', name: 'Renewal radar', trigger: 'schedule', cadence: 'Mondays 09:00',
    next_run: 'paused', skill: 'proc/renewal-review@1.5.0', workbench: 'Procurement', owner: 'Tomas F.', env: 'prod',
    ceiling: 'suggest', state: 'paused', runs_30d: 3, human_touches: 3,
    last: 'paused with the skill — the skill is in review',
    on_gate: 'It cannot be enabled ahead of the skill it invokes. Reviewing the skill stops every trigger that depends on it, which is why the dependency list is part of the review screen.' },
  { key: 'evt/cto-fleet-watch', name: 'Fleet reversal watch', trigger: 'event', cadence: 'reversal rate over target for 24h',
    next_run: 'on event', skill: 'cto/fleet-review@1.0.0', workbench: 'CTO', owner: 'Maya L.', env: 'prod',
    ceiling: 'suggest', state: 'enabled', runs_30d: 5, human_touches: 5,
    last: '1 anomaly raised (WB-IT 2.4% vs 1.0%)',
    on_gate: 'It can raise an anomaly and propose a containment. It cannot pin a version or touch a ceiling: both of those are typed, dual-control acts.' },
  { key: 'mbk/lic-trueup-pack', name: 'Licence true-up pack', trigger: 'manual', cadence: 'runbook, no schedule',
    next_run: 'when a human runs it', skill: 'itsm/licence-audit@1.7.0', workbench: 'IT Manager', owner: 'Priya R.', env: 'prod',
    ceiling: 'approve', state: 'enabled', runs_30d: 1, human_touches: 1,
    last: 'pack sent after the manager released it',
    on_gate: 'Deliberately NOT scheduled: this one leaves the company, so it stays a runbook a person has to press. Not every automation should be a cron.' }
];

/* ============================================================
   CONNECTED APPS — the access layer under the skills.
   A credential lives in the vault and is never readable by the agent.
   When an app has no API at all, the app says so and the browser lane
   is named as the path — with a human present.
   ============================================================ */
window.CONNECTORS = [
  { key: 'erp.corp.internal', name: 'ERP (finance core)', what: 'invoices, purchase orders, goods receipts, journal staging',
    auth: 'service account', auth_detail: 'secret held in the credential vault · rotated 2026-09-01 · agent never reads it',
    owner: 'Finance Controls (R. Okafor)', scopes: ['invoice:read', 'po:read', 'receipt:read', 'annotation:write'],
    data_classes: ['financial', 'confidential'], granted: '2024-02-11', last_review: '2026-07-12', next_review: '2027-01-12', status: 'granted',
    note: 'Write scope stops at annotations. Posting to the ledger is not a scope this grant can ever hold.' },
  { key: 'docs.corp.internal', name: 'Document store (vendor portal)', what: 'supplier documents, registration certificates, bank letters',
    auth: 'service account', auth_detail: 'vault secret · read-only role',
    owner: 'Procurement', scopes: ['document:read'], data_classes: ['confidential'],
    granted: '2025-03-02', last_review: '2026-05-20', next_review: '2026-11-20', status: 'granted',
    note: 'Read-only. Uploading or amending supplier documents is a human act on the portal.' },
  { key: 'itsm.corp.internal', name: 'ITSM (tickets and changes)', what: 'tickets, devices, change records, CMDB objects',
    auth: 'OAuth app', auth_detail: 'client credentials · scoped to one service identity · consent reviewed annually',
    owner: 'IT Operations', scopes: ['ticket:read', 'ticket:comment', 'device:read', 'change:read', 'change:request'],
    data_classes: ['internal', 'confidential'], granted: '2023-11-30', last_review: '2026-06-15', next_review: '2026-12-15', status: 'granted',
    note: 'It can raise a change request. It cannot approve one, not even its own.' },
  { key: 'cmdb.corp.internal', name: 'CMDB (discovery)', what: 'configuration items and discovery reconciliation',
    auth: 'service account', auth_detail: 'vault secret · read-only role enforced server-side',
    owner: 'IT Operations', scopes: ['ci:read'], data_classes: ['internal'],
    granted: '2024-09-09', last_review: '2026-04-02', next_review: '2026-10-02', status: 'review due',
    note: 'Review due: the control owner must re-attest the scopes, or the grant expires.' },
  { key: 'licensing.corp.internal', name: 'Licence telemetry', what: 'seat assignments and 90-day usage telemetry',
    auth: 'API key in vault', auth_detail: 'vendor-issued key · read-only · expires 2027-02-01',
    owner: 'IT Manager', scopes: ['seat:read', 'usage:read'], data_classes: ['internal', 'financial'],
    granted: '2026-01-19', last_review: '2026-08-08', next_review: '2027-02-08', status: 'granted',
    note: 'Feeds the true-up pack. It cannot reclaim a seat — that happens in the vendor console, with a human.' },
  { key: 'fleet.corp.internal', name: 'Control plane (fleet API)', what: 'workbench inventory, run history, ceilings, reversal rates',
    auth: 'OAuth app', auth_detail: 'platform identity · read-only · cannot write policy',
    owner: 'Platform Engineering', scopes: ['fleet:read', 'runs:read', 'policy:read'], data_classes: ['internal'],
    granted: '2026-02-01', last_review: '2026-09-01', next_review: '2027-03-01', status: 'granted',
    note: 'Deliberately read-only: the surface that shows you the ceilings must not be able to change them.' },
  { key: 'hr.corp.internal', name: 'HRIS (on-prem, NO API)', what: 'employee records and the privileged admin console',
    auth: 'browser lane', auth_detail: 'agent window on the human session · no stored credential at all',
    owner: 'People Ops', scopes: ['employee:read (with a human present)', 'session:borrow (confirmed per use)'],
    data_classes: ['confidential', 'regulated'], granted: '2026-04-14', last_review: '2026-09-14', next_review: '2026-12-14', status: 'lane only',
    note: 'No API exists, so this app is reached through the browser lane: the agent drives a window on the human session, and every borrow is confirmed by the person. This is the app that blocked the contractor offboarding (ESC-3312).' },
  { key: 'analytics.corp.internal', name: 'Analytics workspace', what: 'dashboards, report subscriptions and model refresh status',
    auth: 'user session (Entra SSO)', auth_detail: 'no stored credential · the agent rides the employee Entra session and acts as them',
    owner: 'Data Platform', scopes: ['dashboard:read', 'report:subscribe'], data_classes: ['internal', 'financial'],
    granted: '2026-05-30', last_review: '2026-08-30', next_review: '2027-02-28', status: 'granted',
    note: 'Reached as the employee, so it inherits their entitlement rather than a reduced grant. Which skills may use it is a ceiling decision, not a scope decision.' },
  { key: 'carrier.portal', name: 'Carrier portal (external)', what: 'claim status, policy documents, carrier correspondence',
    auth: 'browser lane', auth_detail: 'no stored credential · a window on the employee session · borrow confirmed per use',
    owner: 'Claims & Operations', scopes: ['claim:read (with a human present)', 'document:download'],
    data_classes: ['confidential', 'regulated', 'third_party'],
    granted: '—', last_review: '2026-09-20', next_review: '2026-10-04', status: 'tos review',
    note: 'The fourth access case: a third party we do not control. No API, no agent account, and the vendor terms of service are the actual gate — automation without written consent is a contract risk, not a technical one. Until that is answered this app is read-only by hand.' },
  { key: 'mail.corp.internal', name: 'Shared mailboxes', what: 'vendor mailbox, legal-notice mailbox',
    auth: 'OAuth app', auth_detail: 'mailbox-scoped · cannot send from any other identity',
    owner: 'IT Operations', scopes: ['mail:read (2 mailboxes)', 'mail:label'], data_classes: ['confidential'],
    granted: '2025-06-21', last_review: '2026-08-30', next_review: '2027-02-28', status: 'granted',
    note: 'It cannot send. Outbound mail is always a review-and-send gate in a workbench.' }
];
/* ============================================================
   THE ASSISTANT'S OWN ANSWERS
   The universal Chat tab runs the same widget machinery as a workbench composer: same
   grant, same gate, same audit. What it adds is the questions that are about the
   assistant itself, which is what a person asks first.
   ============================================================ */
window.CHAT = {
  title: 'Chat with your assistant',
  note: 'One session, bound to your workbench and your profile. Answers cite their source; a request for work carries the same grant as a button and stops at the same gate.',
  answers: [
    { q: 'What can you not do?', a: 'Quite a lot, by design. I cannot exceed my ceiling on any skill (a few of mine stop at suggest, so they can read and propose but never act). I cannot release money, send mail, wipe a device or change a permission without a gate that a human passes. I cannot reach a system I have no grant for, and I cannot read a credential · the vault fills them without me. And I will not improvise: if no skill matches your request I say so and offer to draft one.',
      cite: 'ceiling = min(skill, workbench) · gates: approval, typed confirmation, review-and-send, MFA' },
    { q: 'What changed since yesterday?', a: 'Three things worth your attention: one vendor bank detail changed (held, not posted), one SLA is 40 minutes from breach on a ticket that has no owner, and one automation is paused because the skill it invokes is in review. Everything else ran and is in the record.',
      cite: 'audit chain, last 24h · 41 events' },
    { q: 'Who approved the last exception?', a: 'You did, this morning, on INV-40225 · a release gate with the policy version and the blast radius attached. The chain carries your identity, the skill version and the run id, so it can be replayed exactly.',
      cite: 'chain entry: run.release · actor=you, countersigned by AP-POL-2 v4' },
    { q: 'How do I get a new skill?', a: 'Three ways, all reviewed: save a run you already did (the platform derives the capabilities from what the run actually touched), fork one from the team library with a narrower grant, or import a signed bundle if you are an admin. You never describe your own permissions · that is the point.',
      cite: 'authoring paths · review + named owner + expiry required' }
  ]
};


/* ============================================================
   ACCESS MODELS — who the agent IS when it reaches an app.
   This is the question that decides what is even possible:

     service identity   the agent acts as itself, scoped and vault-held.
                        It can work unattended, at 03:00, with no human.
     user session       the agent rides the employee's own SSO session, so it
                        acts AS THE EMPLOYEE. Broader authority, zero credentials
                        stored — and structurally unable to run unattended.
     browser lane       no API at all: a window on the human session, borrow
                        confirmed per use. Same limits as a user session.

   Jordan Reyes' view shows the first two as "SSO" and "Browser". The service
   identity is the one that makes bounded autonomy possible — and the one that
   makes attribution a design problem, not an afterthought.
   ============================================================ */
window.CONNECTOR_ACCESS = {
  'erp.corp.internal': { model: 'service identity', last_used: '3 min ago', unattended: 'yes',
    why_unattended: 'A scoped service identity with no human session involved, so a 06:00 sweep can use it.',
    attribution: 'Written as the service identity, tagged with the skill and run id.' },
  'docs.corp.internal': { model: 'service identity', last_used: '6 min ago', unattended: 'yes',
    why_unattended: 'Read-only role; safe for scheduled document checks.',
    attribution: 'Service identity + run id.' },
  'itsm.corp.internal': { model: 'service identity', last_used: '22 min ago', unattended: 'yes',
    why_unattended: 'One service identity, consent reviewed annually — this is what lets the SLA watcher fire at any hour.',
    attribution: 'Service identity; change requests carry the requesting run id.' },
  'cmdb.corp.internal': { model: 'service identity', last_used: 'yesterday', unattended: 'yes',
    why_unattended: 'Read-only reconciliation; no writes to attribute.',
    attribution: 'Service identity (reads only).' },
  'licensing.corp.internal': { model: 'service identity', last_used: '2 h ago', unattended: 'yes',
    why_unattended: 'Vendor key in the vault, read-only, expires 2027-02-01.',
    attribution: 'Service identity + run id.' },
  'fleet.corp.internal': { model: 'service identity', last_used: '1 min ago', unattended: 'yes',
    why_unattended: 'Read-only by design: the surface that shows you the ceilings must not be able to change them.',
    attribution: 'Service identity.' },
  'mail.corp.internal': { model: 'service identity', last_used: '12 min ago', unattended: 'yes',
    why_unattended: 'Mailbox-scoped read so the bank-detail watcher can quarantine at any hour. It cannot send.',
    attribution: 'Service identity + run id; sending is never this grant.' },
  'hr.corp.internal': { model: 'browser lane', last_used: '4 min ago', unattended: 'no',
    why_unattended: 'It rides YOUR Entra session, so it cannot work at 03:00. The offboarding run queues and waits for a human instead.',
    attribution: 'Recorded as the employee, tagged agent-on-behalf-of — bsk events carry no identity by themselves, so the control plane supplies it (design doc §11).',
    recommend: 'Stays on the lane: no API exists. The compensations are the per-use borrow confirmation and the human-present rule.' },
  'analytics.corp.internal': { model: 'user session', last_used: 'yesterday', unattended: 'no',
    why_unattended: 'Reached as you, through your Entra session. If you are signed out the agent says so and stops rather than retrying.',
    attribution: 'Recorded as you, tagged agent-on-behalf-of. Your entitlement, not a reduced grant — which is exactly why a ceiling still applies to which skills may use it.',
    recommend: 'Split it: read as the employee so row-level security follows their entitlement, but publish and refresh under a service identity — a dashboard owned by a person breaks the day that person leaves.' },
  'carrier.portal': { model: 'browser lane', last_used: '4 min ago', unattended: 'no',
    why_unattended: 'A third party we do not control: no API and no agent account, so it rides the employee session and a person must be present for every use.',
    attribution: 'Recorded as the employee at the carrier, tagged agent-on-behalf-of by the control plane — the carrier would not know an agent was involved unless we say so.',
    recommend: 'Keep it on the lane, but let the contract answer first: written consent to automate, or this portal stays hand-driven. Nothing technical unlocks it.' }
};

/* ============================================================
   SESSION HISTORY
   Two histories, and conflating them is the classic mistake.
     transcripts  = yours. Searchable, resumable, expirable, deletable.
     action record = not yours. Append-only, hash-chained, no delete path.
   An employee may manage the first. Nobody manages the second.
   ============================================================ */
window.SESSIONS = {
  policy: 'Transcripts are yours to keep, rename or delete, and they expire after 90 days. The action record is neither: every run stays in the audit chain, including the record that a transcript was deleted.',
  items: [
    { id: 'S-2041', when: 'today 09:14', wb: 'Accounts Payable Clerk', exchanges: 11, ran: ['CHAT-AP-SWEEP-1'],
      note: 'Invoice sweep asked for in chat, stopped at the release gate, released by you.', transcript: 'me: match today’s invoices ···  5 minutes of tool output  ··· you: released the 5 exceptions.' },
    { id: 'S-2038', when: 'yesterday 16:40', wb: 'Accounts Payable Clerk', exchanges: 4, ran: [],
      note: 'Two policy questions answered from the source, one refusal (no skill for a vendor re-index).', transcript: 'me: why is Helios on hold?  ···  answered with its source  ···  me: reindex the vendor master tonight?  ···  refused.' },
    { id: 'S-2033', when: 'Tue 11:02', wb: 'IT Support', exchanges: 7, ran: ['CHAT-IT-CERT-2'],
      note: 'Certificate rotation completed inside the grant; device wipe stopped at the typed gate.', transcript: 'me: rotate the expiring certificates  ···  done, 12 rotated  ···  me: wipe LT-2291  ···  typed confirmation required.' },
    { id: 'S-2029', when: 'Mon 08:55', wb: 'CTO', exchanges: 5, ran: [],
      note: 'Portfolio questions: what is paused, what is waiting on a human, what changed this week.', transcript: 'me: what is waiting on me?  ···  3 items, 2 gates, 1 review.' },
    { id: 'S-2014', when: 'Fri 15:20', wb: 'Procurement', exchanges: 9, ran: ['REQ-7790'],
      note: 'Renewal review hit its ceiling (auto) and was refused rather than escalated silently.', transcript: 'me: renew Northwind automatically  ···  refused: that exceeds my ceiling, here is the approval path.' }
  ]
};

/* ============================================================
   AUTOMATION RUN HISTORY
   An automation is a trigger. Its history is the answer to "what has this thing
   actually been doing" — every run with what invoked it, which skill version
   answered, and how it ended: completed, stopped at a gate, or refused.
   A refusal is not a failure. It is the ceiling working.
   ============================================================ */
window.AUTO_RUNS = {
  'sch/ap-daily-invoice-sweep': { summary: '30 days: 22 runs · 20 completed, 2 stopped at the release gate and released', note: 'Every run ends with the hard rows queued. That is the design, not a defect.', runs: [
    { t: 'today 06:00', trig: 'schedule', out: 'stopped at gate', skill: 'ap/invoice-triage@2.3.1', dur: '1m 12s', why: '5 rows queued, released by a human at 09:20' },
    { t: 'yesterday 06:00', trig: 'schedule', out: 'completed', skill: 'ap/invoice-triage@2.3.1', dur: '58s', why: '14 rows, 9 annotated, 5 queued' },
    { t: 'Wed 09:41', trig: 'chat', out: 'stopped at gate', skill: 'ap/invoice-triage@2.3.1', dur: '1m 04s', why: 'asked for in the assistant, stopped at the same gate' } ] },
  'evt/ap-bank-detail-watch': { summary: '30 days: 7 runs · 5 quarantined for review, 2 cleared as false alarms', note: 'It has never been able to post a change. Read and quarantine only.', runs: [
    { t: 'Mon 11:02', trig: 'event', out: 'completed', skill: 'ap/bank-change-guard@1.1.0', dur: '9s', why: 'detail changed, row held for a human' },
    { t: 'Sep 14', trig: 'event', out: 'completed', skill: 'ap/bank-change-guard@1.1.0', dur: '8s', why: 'no change, nothing written' } ] },
  'sch/it-cert-rotate': { summary: '30 days: 4 runs · 4 completed unattended', note: 'The only automation here that finishes with nobody watching, because its skill is narrow and non-destructive.', runs: [
    { t: 'Sun 01:00', trig: 'schedule', out: 'completed', skill: 'it/vpn-cert-rotate@7.0.0', dur: '42s', why: '12 rotated, 0 failures, 2 devices retried' },
    { t: 'Sep 14 01:00', trig: 'schedule', out: 'completed', skill: 'it/vpn-cert-rotate@7.0.0', dur: '39s', why: '12 rotated' } ] },
  'evt/it-sla-watch': { summary: '30 days: 18 runs · 12 completed, 6 stopped at a gate', note: 'A gate opened at 03:00 waits. It does not expire, and it does not approve itself.', runs: [
    { t: 'today 03:12', trig: 'event', out: 'stopped at gate', skill: 'itsm/queue-triage@3.1.0', dur: '22s', why: 'breach in 40 min, escalation queued for an owner' },
    { t: 'yesterday 22:40', trig: 'event', out: 'completed', skill: 'itsm/queue-triage@3.1.0', dur: '14s', why: 'priority adjusted, no human needed' } ] },
  'sch/fin-variance-sweep': { summary: '30 days: 21 runs · 21 completed, 0 writes', note: 'A suggest-level skill: it can annotate and narrate, and cannot change a number.', runs: [
    { t: 'today 07:30', trig: 'schedule', out: 'completed', skill: 'fin/variance-narrator@1.7.0', dur: '2m 03s', why: '6 variances narrated, 2 flagged for a human' } ] },
  'evt/hr-deadline-watch': { summary: '30 days: 30 runs · 28 completed, 2 refused by the ceiling', note: 'Refusals are the ceiling working, not the automation failing.', runs: [
    { t: 'today 08:00', trig: 'schedule', out: 'completed', skill: 'hr/deadline-watch@2.0.1', dur: '31s', why: '4 deadlines tracked, 1 owner chased' },
    { t: 'Sep 11 08:00', trig: 'schedule', out: 'refused', skill: 'hr/deadline-watch@2.0.1', dur: '6s', why: 'asked to read employee PII outside its ceiling — refused, not escalated' } ] },
  'sch/proc-renewal-radar': { summary: 'paused 12 days · 3 runs before the pause, 1 refused', note: 'Paused because the skill it invokes is in review. It will not resume on its own, and nothing queues behind it.', runs: [
    { t: 'Sep 12 09:00', trig: 'schedule', out: 'refused', skill: 'proc/renewal-review@1.5.0', dur: '4s', why: 'skill asked for auto; its ceiling is approve — refused at the ceiling' },
    { t: 'Sep 05 09:00', trig: 'schedule', out: 'completed', skill: 'proc/renewal-review@1.5.0', dur: '48s', why: '2 renewals reviewed, both held for approval' } ] },
  'evt/cto-fleet-watch': { summary: '30 days: 5 runs · 5 completed, read-only', note: 'It watches; it cannot change anything it watches.', runs: [
    { t: 'yesterday 18:00', trig: 'event', out: 'completed', skill: 'cto/fleet-review@1.0.0', dur: '1m 26s', why: 'reversal rate flat, no action' } ] },
  'mbk/lic-trueup-pack': { summary: 'never scheduled · 1 recorded run, run by hand', note: 'Deliberately not scheduled: the pack leaves the company. It stays a runbook with a human at the keyboard.', runs: [
    { t: 'Apr 02 14:10', trig: 'manual', out: 'stopped at gate', skill: 'itsm/licence-audit@1.7.0', dur: '3m 40s', why: 'send gate: the pack leaves the estate, so a person signs it' } ] }
};

/* What "Run now" does, per automation. Absent means this automation has no manual
   trigger on purpose — do not invent one. */
window.AUTO_MANUAL = {
  'sch/ap-daily-invoice-sweep': { skill: 'ap/invoice-triage@2.3.1', label: 'Daily invoice sweep (run now)',
    steps: [['Read the invoice inbox', '14 rows since 06:00'], ['Matched against PO and goods receipt', '9 three-way matches'],
      ['Annotated the clean rows', '9 annotations, nothing posted'], ['Stopped at the exceptions', '5 rows need a human']],
    gate: { kind: 'approval', title: 'Release the 5 matched exceptions', kv: [['Object', '5 invoices above tolerance or flagged'], ['Blast radius', 'CAD 96,400.00 of payment volume'], ['Evidence', '9 clean rows annotated · 5 held with reasons'], ['Reversible?', 'Yes until release']],
      policy: 'AP-POL-2 v4 · exception release', options: [{ label: 'Release the 5', act: 'approve', cls: 'pri' }, { label: 'Hold and open each one', act: 'hold' }, { label: 'Reject', act: 'reject', cls: 'danger' }] },
    after: [['Released 5 invoices to the payment run', 'next run 16:00'], ['Posted the annotations', 'no ledger entries — annotation scope only']],
    outcome: 'Sweep complete, exceptions released by a human.' },
  'sch/it-cert-rotate': { skill: 'it/vpn-cert-rotate@7.0.0', label: 'Certificate rotation (run now)', completes: true,
    does: 'Done — 12 certificates rotated on the VPN concentrators. Non-destructive and inside its grant, so it finished without a gate. Two devices did not answer and will retry at 02:00.' },
  'sch/proc-renewal-radar': { skill: 'proc/renewal-review@1.5.0', label: 'Renewal radar (run now)', refused: 'Refused before it started: this automation is paused because the skill it invokes is in review, and its skill ceiling is approve — a renewal cannot be committed unattended.' }
};

/* ============================================================
   THE SKILL LIBRARY — who may do what with a skill, and the two
   company-owned baselines every employee inherits.
   Employees need three verbs, not a permission system:
     add (in three reviewed ways)  ·  fork narrower  ·  archive
   "Remove" exists but almost never applies: anything that has ever run
   stays in the record, so the honest operation is always archive.
   ============================================================ */
window.SKILL_LIBRARY = {
  legend: 'A skill is what may be done, and how far. An automation decides when it happens. A connected app decides where it may reach, and as whom.',
  rules: [
    'An automation invokes a skill. It can never widen one.',
    'Anything that has ever run cannot be removed — only archived.',
    'Archiving a skill pauses the automations that invoke it.'
  ],
  roles: [
    { who: 'You (employee)', may: 'use it · fork it narrower · propose a change', may_not: 'cannot edit a company skill, cannot widen any grant' },
    { who: 'Owner (a named person)', may: 'publish · archive · restore · set the review date', may_not: 'cannot approve their own ceiling raise' },
    { who: 'Admin (platform)', may: 'import a signed bundle · retire a version · set the org ceiling', may_not: 'cannot author capabilities on anyone else\u2019s behalf' }
  ],
  corporate: [
    { key: 'corp/offboarding-baseline', version: '3.0.2', name: 'Offboarding baseline', library: 'company', status: 'published',
      owner: 'Company (Security + People Ops)', mandated: 'Every leaver runs this. Fork it, use it \u2014 editing it is not an employee action.',
      grant: { scope: 'identity + hr.corp.internal read, browser lane (human present)', environment: 'prod', ceiling: 'approve', domains: ['hr.corp.internal','identity.corp.internal'], approved_by: 'Group Security (M. Ferreira)', expires: '2027-06-30' },
      capabilities: [
        { t: 'Reclaim identity, then hardware, then data \u2014 in that order', e: 'identity.revoke \u2192 asset.return \u2192 data.wipe.gate' },
        { t: 'Stop for a human at anything destructive', e: 'device.wipe requires a typed release' },
        { t: 'NOT permitted: skip a step, or run with nobody present', e: 'browser-lane steps need a human session' } ],
      metrics: { runs: 96, approvals: 96, rollbacks: 0, last_used: '2h ago' } },
    { key: 'corp/records-retention', version: '1.4.0', name: 'Records retention sweep', library: 'company', status: 'published',
      owner: 'Company (Legal)', mandated: 'Company baseline. It flags what is past its retention date; it has never been able to delete.',
      grant: { scope: 'docs + mail read, quarantine write', environment: 'prod', ceiling: 'suggest', domains: ['docs.corp.internal','mail.corp.internal'], approved_by: 'Legal (A. Nwosu)', expires: '2027-01-31' },
      capabilities: [
        { t: 'Flag anything past its retention date for a human', e: 'docs.flag(expired) \u2014 never deletes' },
        { t: 'NOT permitted: delete, shred or export', e: 'deletion is not in the grant at all' } ],
      metrics: { runs: 240, approvals: 18, rollbacks: 0, last_used: 'yesterday' } }
  ]
};

/* ============================================================
   THE INDEX — nothing in this estate may be cited that you cannot
   look up. Every widget that runs at a level carries
   `auto: { level, skill }` and every automation carries `skill`;
   those citations ARE grants. This walks the whole estate once and
   scaffolds a record for any skill that is in use but not written
   up, so a badge can never point at a page that does not exist.
   ============================================================ */
(function indexCitedSkills() {
  const NARROW = { suggest: 0, approve: 1, auto: 2 };
  const known = {};
  window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || []).forEach(s => { known[s.key] = true; });
  const found = {};
  const note = (citation, where, level) => {
    if (!citation || typeof citation !== 'string' || citation.indexOf('@') < 1) return;
    const key = citation.split('@')[0], ver = citation.split('@')[1];
    if (known[key]) return;
    const f = found[key] || (found[key] = { version: ver, ceiling: null, where: [] });
    if (level && (f.ceiling === null || NARROW[level] < NARROW[f.ceiling])) f.ceiling = level;
    if (where && f.where.indexOf(where) < 0) f.where.push(where);
  };
  const CITE = /[a-z][a-z0-9_-]*\/[a-z0-9_-]+@[0-9]+\.[0-9]+\.[0-9]+/g;
  const scan = (o, where) => {
    if (typeof o === 'string') { (o.match(CITE) || []).forEach(c => note(c, where, null)); return; }
    if (!o || typeof o !== 'object') return;
    if (o.auto && o.auto.skill) note(o.auto.skill, where, o.auto.level);
    if (typeof o.skill === 'string') note(o.skill, where, o.ceiling);
    Object.keys(o).forEach(k => {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(x => scan(x, where));
      else scan(v, where);
    });
  };
  (window.WORKBENCHES || []).forEach(wb => scan(wb.widgets || [], wb.short || wb.key));
  scan(window.AUTOMATIONS || [], 'automations');
  scan(window.AUTO_RUNS || {}, 'run history');
  scan(window.SKILL_PROVENANCE || {}, 'skill provenance');
  scan(window.SKILLS || [], 'skill provenance');
  const SMALL = { qa: 'QA', itsm: 'ITSM', it: 'IT', ap: 'AP', hr: 'HR', vpn: 'VPN', cto: 'CTO', fin: 'Fin', ops: 'Ops', erp: 'ERP', sso: 'SSO' };
  const human = k => k.split('/').pop().split('-').map(x => SMALL[x] || (x.charAt(0).toUpperCase() + x.slice(1))).join(' ');
  Object.keys(found).forEach(k => {
    const f = found[k];
    window.SKILLS.push({
      key: k, version: f.version, name: human(k), library: 'personal', abridged: true,
      status: 'published (indexed)', owner: 'Unassigned \u2014 indexed from use',
      grant: { scope: 'as cited where it is used', environment: 'prod', ceiling: f.ceiling || 'approve', domains: [], approved_by: 'indexed from an existing grant', expires: '\u2014' },
      capabilities: [{ t: 'Indexed because this estate already cites it in ' + f.where.length + ' place' + (f.where.length > 1 ? 's' : ''), e: 'the grant lives with whatever cites it \u2014 indexing never widens anything' }],
      metrics: { runs: 0, approvals: 0, rollbacks: 0, last_used: '\u2014' },
      cited_by: f.where
    });
  });
  window.SKILL_INDEX = { scaffolded: Object.keys(found).length, full: window.SKILLS.length - Object.keys(found).length };
})();


window.CONNECTOR_MARKET = {
  categories: [
    { key: 'system',  name: 'Runs on the machine you are signed in to' },
    { key: 'itsm',    name: 'IT service & operations' },
    { key: 'finance', name: 'Finance & ERP' },
    { key: 'people',  name: 'People & HR' },
    { key: 'crm',     name: 'Customer & sales' },
    { key: 'data',    name: 'Data & reporting' },
    { key: 'collab',  name: 'Collaboration, documents & vendors' }
  ],
  apps: [
    { id: 'lane.browser', name: 'Browser lane', cat: 'system', auth: 'your session, borrowed per tab', rule: 'self', approver: 'your manager',
      line: 'Drive a real browser window on the pages you are already signed in to.', scopes: ['page.read', 'page.act', 'screenshot'], classes: ['internal'],
      why: '', note: 'Already connected in this demo.' },
    { id: 'lane.desktop', name: 'macOS apps', cat: 'system', auth: 'your signed-in session', rule: 'self', approver: 'your manager',
      line: 'Calendar, Reminders, Notes and Finder on this Mac, through Accessibility.', scopes: ['calendar.read', 'reminders.write', 'notes.read'], classes: ['personal', 'internal'],
      why: '', note: '' },
    { id: 'servicenow', name: 'ServiceNow', cat: 'itsm', auth: 'service identity', rule: 'admin', approver: 'ServiceNow platform owner',
      line: 'Read and update incidents, changes and CMDB records.', scopes: ['incident.read', 'incident.write', 'cmdb.read'], classes: ['internal', 'confidential'],
      why: 'Incident and change writes are a production change path. An administrator grants it, and the grant names the table allow-list. The read-only scopes can be requested by you \u2014 the write scopes cannot.', note: '' },
    { id: 'jira', name: 'Jira', cat: 'itsm', auth: 'service identity', rule: 'self', approver: 'your manager + Jira site admin',
      line: 'Search and update issues, and read sprint boards for your teams.', scopes: ['issue.read', 'issue.write', 'sprint.read'], classes: ['internal'], why: '', note: '' },
    { id: 'pagerduty', name: 'PagerDuty', cat: 'itsm', auth: 'service identity', rule: 'self', approver: 'your manager + the on-call owner',
      line: 'Read on-call schedules and open incidents.', scopes: ['schedule.read', 'incident.read'], classes: ['internal'], why: '', note: '' },
    { id: 'sap', name: 'SAP S/4HANA', cat: 'finance', auth: 'service identity (segregation of duties)', rule: 'service', approver: 'Finance Systems (control owner)',
      line: 'Post and read journal entries, purchase orders and vendor master data.', scopes: ['journal.read', 'journal.write', 'vendor.write'], classes: ['financial', 'restricted'],
      why: 'A personal grant would break segregation of duties, and unattended posting needs an identity of its own. It is installed by the finance systems team, with a named approver per action class.', note: '' },
    { id: 'netsuite', name: 'NetSuite', cat: 'finance', auth: 'service identity', rule: 'self', approver: 'your manager + Finance Controls',
      line: 'Vendor bills, expense reports and month-end close tasks.', scopes: ['bill.read', 'expense.read', 'close.read'], classes: ['financial'], why: '', note: '' },
    { id: 'coupa', name: 'Coupa', cat: 'finance', auth: 'service identity', rule: 'self', approver: 'Procurement owner',
      line: 'Requisitions, purchase orders and supplier records.', scopes: ['requisition.read', 'po.write', 'supplier.read'], classes: ['financial'], why: '', note: '' },
    { id: 'workday', name: 'Workday HCM', cat: 'people', auth: 'service identity', rule: 'admin', approver: 'People Systems (data steward)',
      line: 'Worker records, org data and time-off balances.', scopes: ['worker.read', 'timeoff.read'], classes: ['personal', 'restricted'],
      why: 'Worker records are the most sensitive data in the company. An administrator grants it, every read is attributed, and the People team can review the whole chain.', note: '' },
    { id: 'salesforce', name: 'Salesforce', cat: 'crm', auth: 'service identity', rule: 'self', approver: 'your manager + RevOps',
      line: 'Accounts, opportunities and activity history for your territory.', scopes: ['account.read', 'opportunity.read', 'activity.write'], classes: ['confidential'], why: '', note: '' },
    { id: 'snowflake', name: 'Snowflake', cat: 'data', auth: 'service identity (read-only role)', rule: 'self', approver: 'Data platform owner',
      line: 'Query curated marts, read-only, with row-level policy already applied.', scopes: ['mart.read'], classes: ['internal', 'financial'], why: '', note: '' },
    { id: 'powerbi', name: 'Power BI', cat: 'data', auth: 'service identity', rule: 'self', approver: 'BI platform owner',
      line: 'Refresh and read the semantic models your team owns.', scopes: ['dataset.read', 'dataset.refresh'], classes: ['internal'], why: '', note: '' },
    { id: 'm365', name: 'Microsoft 365', cat: 'collab', auth: 'service identity (mailbox-scoped)', rule: 'self', approver: 'your manager + M365 admin',
      line: 'Mail, calendar and files \u2014 through a mailbox-scoped identity, never your personal one.', scopes: ['mail.read', 'calendar.write', 'files.read'], classes: ['internal', 'confidential'], why: '', note: '' },
    { id: 'carrier', name: 'Carrier portal (vendor)', cat: 'collab', auth: 'browser lane, per-tab', rule: 'lane', approver: 'Procurement (terms-of-service review open)',
      line: 'Check shipment and claim status on a vendor site with no API.', scopes: ['page.read', 'form.fill'], classes: ['internal'],
      why: 'The vendor offers no API and its terms of service are the gate. It stays on the browser lane, watched, one tab at a time, and no password is ever stored for it.', note: '' }
  ]
};

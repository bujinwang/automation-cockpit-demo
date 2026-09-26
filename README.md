ACME Automation Cockpit -- demo

Open index.html in a browser. That is the whole install.

What works in this copy
  * every workbench, the skill studio, the automations, the connected-app market,
    the chat lane, the audit record -- all of it, driven by the records in workbenches.js.
  * "a workbench is data, not code": add a record to workbenches.js and a new role appears.

What does not work in this copy
  * the LIVE browser-lane badge. It needs the real `bsk` daemon and a Chrome extension on
    the machine hosting it, so it reads "offline" here -- on purpose, instead of failing.
    Everything else in the demo does not depend on it.
  * nothing here connects to a real system. Amounts, people and evidence are fixtures.

Served over http it behaves exactly like the local build; from file:// the five live-lane
checks are the only difference.

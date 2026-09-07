<!--
  The pomodoro timer. YouTube embeds may not load in a sandboxed run, so the
  scene only exercises the timer, the phase switch, and the ledger toggle.
-->

# visitor can start a pomo and skip to the break

visitor:

- openTo /pomodance
- see pomodance-page
- see clock
- wait 1000
- typeInto intention-input 'write a scene'
- click start-button
- seeText Pause
- see ledger-entry #1
- click switch-button
- seeText break time
- seeText Back to work
- click ledger-toggle
- click ledger-toggle
- see ledger

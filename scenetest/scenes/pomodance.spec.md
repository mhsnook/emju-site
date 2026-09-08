<!--
  The pomodoro timer. YouTube embeds may not load in a sandboxed run, so the
  scene only exercises the timer, the phase switch, the settings dialog and the
  playlist disclosures.
-->

# visitor can start a pomo and skip to the break

visitor:

- openTo /pomodance
- see pomodance-page
- notSee site-header
- notSee site-footer
- see pomodance-footer
- see clock
- wait 1000
- typeInto intention-input 'write a scene'
- click start-button
- see Pause
- see ledger-entry #1
- click switch-button
- seeText break time
- see Pause
- click settings-button
- see settings-dialog
- click ledger-toggle
- click ledger-toggle
- click settings-button
- see ledger
- click break-playlist-toggle
- see break-playlist-input

# visitor can start the timer by entering an intention

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- seeText Intention for this pomo — enter to start
- typeInto intention-input 'start me with the keyboard'
- pressKey Enter
- see Pause
- see ledger-entry #1
- seeText start me with the keyboard
- click start-button
- see Start
- seeText enter to resume
- click intention-input
- pressKey Enter
- see Pause

# visitor can nudge the clock a minute at a time

<!-- a stopped clock does not tick, so each nudge lands on an exact minute -->

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- seeText 25:00
- click shorter-button
- seeText 24:00
- click longer-button
- seeText 25:00
- click forward-button
- seeText 24:00
- click back-button
- seeText 25:00
- click start-button
- see Pause
- see ledger-entry #1
- click reset-button
- see Start
- seeText 25:00

# a minute forward at the end of a pomo rolls on into the break

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- click settings-button
- see settings-dialog
- typeInto work-minutes-input '1'
- click settings-done
- notSee settings-dialog
- click start-button
- see Pause
- click forward-button
- seeText break time
- click back-button
- see ledger-entry #1

# a running pomo survives a reload

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- typeInto intention-input 'keep the pomo going'
- click start-button
- see Pause
- see ledger-entry #1
- wait 1000
- openTo /pomodance
- see pomodance-page
- wait 1000
- see Pause
- see ledger-entry #1
- seeText keep the pomo going

# visitor can edit a pomo, but not delete the one still running

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- typeInto intention-input 'the first draft'
- click start-button
- see ledger-entry #1
- click ledger-edit
- see edit-dialog
- see edit-delete-blocked
- notSee edit-delete
- typeInto edit-intention 'what I actually did'
- click edit-save
- notSee edit-dialog
- seeText what I actually did

# keeper can throw away a pomo that has finished

keeper:

- openTo /pomodance
- see pomodance-page
- wait 1000
- seeText a pomo from an earlier sitting
- see ledger-entry #1
- click ledger-edit
- see edit-dialog
- see edit-delete
- click edit-delete
- notSee edit-dialog
- notSee ledger-entry

# a reviewed pomo survives the switch to break, however short it was

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- typeInto intention-input 'quick but worth keeping'
- click start-button
- see ledger-entry #1
- click ledger-edit
- see edit-dialog
- typeInto edit-note 'already written up'
- check edit-confirmed
- click edit-save
- notSee edit-dialog
- click switch-button
- seeText break time
- see review-dialog
- pressKey Escape
- notSee review-dialog
- see ledger-entry #1
- seeText already written up

# keeper can look back at an earlier day and close the view again

keeper:

- openTo /pomodance
- see pomodance-page
- wait 1000
- seeText a pomo from an earlier sitting
- click history-button
- seeText Past days
- notSee ledger-entry
- see history-day #1
- click history-day #1
- see ledger-entry #2
- seeText something from a day gone by
- click history-back
- seeText Past days
- click history-close
- seeText a pomo from an earlier sitting
- notSee history-day

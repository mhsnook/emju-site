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
- seeText Pause
- see ledger-entry #1
- click switch-button
- seeText break time
- seeText Back to work
- click settings-button
- see settings-dialog
- click ledger-toggle
- click ledger-toggle
- click settings-button
- see ledger
- click break-playlist-toggle
- see break-playlist-input

# a running pomo survives a reload

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- typeInto intention-input 'keep the pomo going'
- click start-button
- seeText Pause
- see ledger-entry #1
- wait 1000
- openTo /pomodance
- see pomodance-page
- wait 1000
- seeText Pause
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

# the last track in a playlist can be changed but not taken away

visitor:

- openTo /pomodance
- see pomodance-page
- wait 1000
- click break-playlist-toggle
- see break-playlist-remove-1
- click break-playlist-remove-1
- notSee break-playlist-remove-0
- see break-playlist-edit-0
- click break-playlist-edit-0
- see break-playlist-edit-input-0
- typeInto break-playlist-edit-input-0 'https://youtu.be/5qap5aO4i9A'
- click break-playlist-edit-save-0
- notSee break-playlist-edit-input-0
- notSee break-playlist-remove-0
- see break-playlist-edit-0

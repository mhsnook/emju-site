<!--
  Submitting the contact form. With the Turnstile test key (the default in dev),
  the challenge widget is skipped and verification is bypassed server-side, so
  this runs without any external network.
-->

# visitor can submit the contact form

visitor:

- openTo /contact
- see contact-page
- see contact-form
- typeInto name-input 'Ada Lovelace'
- typeInto email-input [self.email]
- typeInto company-input 'Analytical Engines'
- typeInto message-input 'We could use a hand wiring up a dashboard for our program team.'
- wait 1500
- click submit-button
- see contact-success
- seeText Thank you

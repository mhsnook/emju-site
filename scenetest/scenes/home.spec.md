<!-- The front page renders and routes through to contact. -->

# visitor can browse the front page

visitor:

- openTo /
- see main-content
- see site-header
- see hero
- seeText We build the tech your team is missing.
- see services
- see service-card #1
- see projects
- see project-card #1
- see site-footer
- seeText EMJU Education & Technology Services, Pvt Ltd

# visitor can get to the contact page from the hero

visitor:

- openTo /
- see hero
- click hero-contact-link
- see contact-page
- see contact-form

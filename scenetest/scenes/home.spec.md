<!-- The front page renders and routes through to contact. -->

# visitor can browse the front page

visitor:

- openTo /
- see main-content
- see site-header
- see hero
- seeText Software Consulting & Incubation
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

# visitor can get to the contact page from the closing call to action

visitor:

- openTo /
- see projects
- click cta-contact-link
- see contact-page
- see contact-form

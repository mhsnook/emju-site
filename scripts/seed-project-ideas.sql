-- Seed / refresh the project_ideas table for the home page.
-- Re-runnable: clears existing rows then re-inserts. Apply with:
--   wrangler d1 execute emju-db --local  --file=scripts/seed-project-ideas.sql
--   wrangler d1 execute emju-db --remote --file=scripts/seed-project-ideas.sql
DELETE FROM project_ideas;
INSERT INTO project_ideas (sort, name, tag, body) VALUES
	(0, 'Add health checks to core tools', 'reliability & dev speed', 'The more we build and publish, the more important it is to have robust tools for checking our work, both before we deploy and after. You might want to keep your eng team focused on moving forward; we can handle details like this.'),
	(1, 'Prototype your own data pipeline', 'data & analytics', 'There are a bunch of options for data pipelines to choose from; if you want, we can wire one up and see how it feels? We’ll get from zero-to-1 quickly, and get something in our analysts’ hands in just a few weeks.'),
	(2, 'Build a microsite (and show it off)', 'campaign launch', 'Maybe you’ve been working with old templates for a while and you just want to build something beautiful from scratch. We can do this work quickly, and as we go, build re-useable components so a throw-away site can help to modernize processes.'),
	(3, 'Turn your brand into a design system', 'design systems', 'After your brand designer hands in their work, you might be left missing a crucual component: a showcase site for future designers and developers to refer to, with colour values, css snippets, react components, etc.'),
	(4, 'Build a totally new experience', 'UX innovation', 'You have an idea, and it could be brilliant, but you’re a long way from firming it up or building institutional support. We need to start small, but it has to be big enough to show the value. This is tricky, but exciting work!'),
	(5, 'Rebuild some infrastructure', 'modernize', 'Sometimes you have to bite down hard and just rebuild something from the ground up. But you need it to be lean, reliable, and maintainable once it’s done. (Fewer headaches please, not more.) We get it. We can help.'),
	(6, 'Leadership coaching', 'skill up & structure', 'We have years of experience coaching tech leaders in the sector, whether you’re an engineer moving into management, or a PM moving into a more technical role, we can help you find your own rhythm, and build the levers and utilities that make you feel at home in your role.'),
	(7, 'Product/team roadmapping', 'team support', '');

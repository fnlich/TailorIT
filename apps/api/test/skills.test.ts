import { afterEach, describe, expect, it } from 'vitest';
import { AddSkillResponseSchema, SkillsResponseSchema } from '@tailorit/shared';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

async function setup(): Promise<{ agent: TestAgent; other: TestAgent }> {
  ctx = createTestContext();
  const me = await signIn(ctx, 'skills@example.com');
  const other = await signIn(ctx, 'skills-other@example.com');
  return { agent: me.agent, other: other.agent };
}

const add = (agent: TestAgent, body: object) => agent.post('/api/skills').set('Origin', ORIGIN).send(body);

describe('/api/skills', () => {
  it('lists the library (1,492 hard, 1,247 soft skills)', async () => {
    const { agent } = await setup();
    const hard = SkillsResponseSchema.parse((await agent.get('/api/skills')).body);
    expect(hard.type).toBe('hard');
    expect(hard.skills).toHaveLength(1492);
    expect(hard.skills).toContain('PostgreSQL');
    const soft = SkillsResponseSchema.parse((await agent.get('/api/skills?type=soft')).body);
    expect(soft.skills).toHaveLength(1247);
  });

  it("answers a skill the library has in the library's spelling, without adding it", async () => {
    const { agent } = await setup();
    const res = await add(agent, { type: 'hard', skill: '  postgresql ' });
    expect(res.status).toBe(200);
    expect(AddSkillResponseSchema.parse(res.body)).toEqual({ added: false, skill: 'PostgreSQL', type: 'hard', category: 'Databases and Storage' });
  });

  it("adds a new skill to the person's own library only, its heading inferred or chosen", async () => {
    const { agent, other } = await setup();
    const res = await add(agent, { type: 'hard', skill: 'Kibana   dashboards' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ added: true, skill: 'Kibana dashboards', type: 'hard', category: 'Observability and Monitoring' });
    expect((await add(agent, { type: 'hard', skill: 'kibana dashboards' })).body).toMatchObject({ added: false, skill: 'Kibana dashboards' });
    const chosen = await add(agent, { type: 'hard', skill: 'Widgetry', category: 'security' });
    expect(chosen.body.category).toBe('Security');
    const invented = await add(agent, { type: 'hard', skill: 'Gizmos', category: 'Not a library heading' });
    expect(invented.body.category).toBe('Frameworks and Libraries');
    const soft = await add(agent, { type: 'soft', skill: 'Bridge building' });
    expect(soft.body).toEqual({ added: true, skill: 'Bridge building', type: 'soft', category: null });

    const mine = (await agent.get('/api/skills')).body.skills as string[];
    expect(mine.slice(-3)).toEqual(['Kibana dashboards', 'Widgetry', 'Gizmos']);
    expect((await agent.get('/api/skills?type=soft')).body.skills).toContain('Bridge building');
    const theirs = (await other.get('/api/skills')).body.skills as string[];
    expect(theirs).not.toContain('Kibana dashboards');
    expect(theirs).toHaveLength(1492);
  });

  it('validates the body', async () => {
    const { agent } = await setup();
    expect((await add(agent, { type: 'hard', skill: '' })).status).toBe(400);
    expect((await add(agent, { type: 'medium', skill: 'X' })).status).toBe(400);
    expect((await add(agent, { type: 'hard', skill: 'x'.repeat(101) })).status).toBe(400);
  });
});

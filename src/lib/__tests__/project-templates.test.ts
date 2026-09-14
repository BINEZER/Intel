/**
 * Project templates.
 *
 * The invariant: whatever a template says, the stages a project is created with
 * total exactly 100%. A template is a hand-written list and exactly the kind of
 * thing someone edits in a hurry, so a typo in a weight must not be able to
 * reach a project and silently distort its progress figure.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_KEY,
  PROJECT_TEMPLATES,
  projectTemplate,
  templateStages,
} from '../project-templates.js';
import { TOTAL_BPS } from '../stage-edit.js';

describe('every template', () => {
  for (const template of PROJECT_TEMPLATES) {
    describe(template.name, () => {
      it('produces stages totalling exactly 100%', () => {
        const total = templateStages(template.key).reduce((a, s) => a + s.weightBps, 0);
        expect(total).toBe(TOTAL_BPS);
      });

      it('has at least one stage, so the project can report progress at all', () => {
        expect(templateStages(template.key).length).toBeGreaterThan(0);
      });

      it('gives every stage a unique key', () => {
        const keys = template.stages.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('names an owner for every stage', () => {
        for (const stage of template.stages) {
          expect(['us', 'client', 'supplier', 'authority']).toContain(stage.owner);
        }
      });

      it('describes what the job is, in words a manager would use', () => {
        expect(template.description.length).toBeGreaterThan(20);
      });
    });
  }
});

describe('the set of templates', () => {
  it('covers non-elevator work, which is the whole point of having templates', () => {
    const keys = PROJECT_TEMPLATES.map((t) => t.key);
    expect(keys).toContain('general');
    expect(keys).toContain('blank');
  });

  it('has unique keys', () => {
    const keys = PROJECT_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('defaults to elevator installation', () => {
    expect(projectTemplate(DEFAULT_TEMPLATE_KEY).key).toBe('elevator_install');
  });
});

describe('projectTemplate', () => {
  it('falls back to the default rather than throwing on an unknown key', () => {
    // A project created from a template that was later renamed must still open.
    expect(projectTemplate('a-template-that-was-deleted').key).toBe(DEFAULT_TEMPLATE_KEY);
  });
});

describe('templateStages', () => {
  it('rescales a drifted template rather than passing the drift on', () => {
    // The blank template is one stage at the full 10000, which is the edge case
    // most likely to break a rescale.
    const blank = templateStages('blank');
    expect(blank).toHaveLength(1);
    expect(blank[0]?.weightBps).toBe(TOTAL_BPS);
  });

  it('keeps the template itself untouched', () => {
    const before = projectTemplate('modernisation').stages.map((s) => s.weightBps);
    templateStages('modernisation');
    expect(projectTemplate('modernisation').stages.map((s) => s.weightBps)).toEqual(before);
  });
});

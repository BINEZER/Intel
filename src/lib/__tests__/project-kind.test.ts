import { describe, expect, it } from 'vitest';
import {
  PROJECT_TYPES,
  isElevatorWork,
  normaliseProjectType,
  projectTypeLabel,
  projectTypeShort,
  typeForTemplate,
  workSplit,
} from '../project-kind.js';

describe('which work is lift work', () => {
  it('counts installation, modernisation and service', () => {
    // Service mobilisation counts: leaving it out understates the lift
    // business by the whole maintenance book.
    expect(isElevatorWork('elevator')).toBe(true);
    expect(isElevatorWork('modernisation')).toBe(true);
    expect(isElevatorWork('service')).toBe(true);
  });

  it('does not count building work', () => {
    expect(isElevatorWork('renovation')).toBe(false);
    expect(isElevatorWork('fit_out')).toBe(false);
    expect(isElevatorWork('other')).toBe(false);
  });

  it('treats the legacy value and a missing one as not lift work', () => {
    expect(isElevatorWork('non_elevator')).toBe(false);
    expect(isElevatorWork(undefined)).toBe(false);
  });

  it('splits a portfolio into two headings', () => {
    expect(workSplit('modernisation')).toBe('elevator');
    expect(workSplit('renovation')).toBe('other');
  });
});

describe('reading a stored type', () => {
  it('keeps every kind that can be chosen', () => {
    for (const type of PROJECT_TYPES) expect(normaliseProjectType(type)).toBe(type);
  });

  it('reads the old two-way value as other work', () => {
    // Written by the model before this one. A stored document cannot be asked
    // to change, so it has to stay readable for ever.
    expect(normaliseProjectType('non_elevator')).toBe('other');
  });

  it('files an unknown or missing value under other rather than throwing', () => {
    // A project with a strange type should still appear in the list.
    // Disappearing is worse than being filed under the wrong heading.
    expect(normaliseProjectType('zipana')).toBe('other');
    expect(normaliseProjectType(undefined)).toBe('other');
    expect(normaliseProjectType(null)).toBe('other');
    expect(normaliseProjectType(7)).toBe('other');
  });

  it('never offers the legacy value as a choice', () => {
    expect(PROJECT_TYPES as readonly string[]).not.toContain('non_elevator');
  });
});

describe('naming the work', () => {
  it('has a label and a short label for every kind', () => {
    for (const type of PROJECT_TYPES) {
      expect(projectTypeLabel(type).length).toBeGreaterThan(0);
      expect(projectTypeShort(type).length).toBeGreaterThan(0);
    }
  });

  it('never says "non elevator" to a person', () => {
    // A bucket named for what something is not can only ever be a residue.
    expect(projectTypeLabel('non_elevator')).toBe('Other work');
    expect(projectTypeShort('non_elevator')).toBe('Other');
  });

  it('distinguishes an installation from a modernisation', () => {
    expect(projectTypeShort('elevator')).not.toBe(projectTypeShort('modernisation'));
  });
});

describe('the type a template implies', () => {
  it('follows the template that was chosen', () => {
    expect(typeForTemplate('elevator_install')).toBe('elevator');
    expect(typeForTemplate('modernisation')).toBe('modernisation');
    expect(typeForTemplate('service_mobilisation')).toBe('service');
  });

  it('falls back to other work for a general or blank template', () => {
    expect(typeForTemplate('general')).toBe('other');
    expect(typeForTemplate('blank')).toBe('other');
    expect(typeForTemplate('something-new')).toBe('other');
  });

  it('only ever implies a type that can be chosen', () => {
    for (const key of ['elevator_install', 'modernisation', 'service_mobilisation', 'general', 'blank']) {
      expect(PROJECT_TYPES as readonly string[]).toContain(typeForTemplate(key));
    }
  });
});

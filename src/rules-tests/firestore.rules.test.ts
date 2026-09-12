/**
 * Security rules behaviour tests.
 *
 * These assert what the rules ENFORCE, not that they parse. Every claim the
 * documentation makes about access control is pinned here, because a rules file
 * that compiles can still be wide open.
 *
 * Run with: npm run test:rules  (starts the Firestore emulator around vitest)
 */

import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let testEnv: RulesTestEnvironment;

const ctx = (uid: string, role: string, active = true) =>
  testEnv.authenticatedContext(uid, { role, active }).firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-intelmotion-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

/** Audit stamps the rules require on every create. */
const stamped = (uid: string) => ({
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: uid,
  updatedBy: uid,
});

const CONTRACT = {
  contractNo: 'C-1', type: 'supply_install', clientId: 'cl1', clientName: 'Acme',
  title: 'Lifts', currency: 'ETB',
  valueNetSantim: 100_000_00, vatRateBps: 1500, vatSantim: 15_000_00,
  valueGrossSantim: 115_000_00, valueEnteredInclusive: false,
  autoRenew: false, renewalWindowDays: 60, renewalAlertAt: null,
  renewalStatus: 'not_due', status: 'draft', attachments: [],
};

const DISBURSEMENT = {
  voucherNo: 'V-1', subcontractorId: 's1', subcontractorName: 'Sub', subcontractorTin: '123',
  projectId: 'p1', phaseId: 'ph1', phaseName: 'Shaft', supplierInvoiceNo: 'SI-1',
  currency: 'ETB',
  netSantim: 100_000_00, vatRateBps: 1500, supplierVatSantim: 15_000_00,
  grossSantim: 115_000_00,
  whtCategory: 'services', whtRateBps: 300, whtBaseSantim: 100_000_00,
  whtSantim: 3_000_00, netPayableSantim: 112_000_00,
  status: 'draft', whtPeriodEc: 'EC-2018-01', whtPeriodGc: '2025-09',
};

describe('unauthenticated access', () => {
  it('is denied everywhere', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'clients/c1')));
    await assertFails(setDoc(doc(anon, 'clients/c1'), { name: 'X' }));
    await assertFails(getDoc(doc(anon, 'contracts/k1')));
  });
});

describe('a signed-in user with no role claim', () => {
  it('cannot read business data', async () => {
    const nobody = testEnv.authenticatedContext('u1').firestore();
    await assertFails(getDoc(doc(nobody, 'clients/c1')));
    await assertFails(getDoc(doc(nobody, 'contracts/k1')));
  });

  it('cannot read business data even with a role that is not activated', async () => {
    const inactive = ctx('u1', 'manager', false);
    await assertFails(getDoc(doc(inactive, 'clients/c1')));
    await assertFails(setDoc(doc(inactive, 'clients/c1'), { name: 'X', ...stamped('u1') }));
  });
});

describe('user self-provisioning', () => {
  it('lets a new user create a powerless profile for themselves', async () => {
    const db = testEnv.authenticatedContext('u1', { email: 'a@b.com' }).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users/u1'), {
        email: 'a@b.com', displayName: 'A', role: 'viewer', active: false, ...stamped('u1'),
      }),
    );
  });

  it('REFUSES a self-created profile that grants itself a role', async () => {
    const db = testEnv.authenticatedContext('u1', { email: 'a@b.com' }).firestore();
    await assertFails(
      setDoc(doc(db, 'users/u1'), {
        email: 'a@b.com', displayName: 'A', role: 'admin', active: true, ...stamped('u1'),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'users/u1'), {
        email: 'a@b.com', displayName: 'A', role: 'viewer', active: true, ...stamped('u1'),
      }),
    );
  });

  it('refuses a profile created for somebody else', async () => {
    const db = testEnv.authenticatedContext('u1', { email: 'a@b.com' }).firestore();
    await assertFails(
      setDoc(doc(db, 'users/u2'), {
        email: 'a@b.com', displayName: 'A', role: 'viewer', active: false, ...stamped('u1'),
      }),
    );
  });

  it('refuses a profile claiming an email the token does not carry', async () => {
    const db = testEnv.authenticatedContext('u1', { email: 'a@b.com' }).firestore();
    await assertFails(
      setDoc(doc(db, 'users/u1'), {
        email: 'boss@b.com', displayName: 'A', role: 'viewer', active: false, ...stamped('u1'),
      }),
    );
  });

  it('stops a user promoting themselves later', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'users/u1'), {
        email: 'a@b.com', displayName: 'A', role: 'viewer', active: true,
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'u1', updatedBy: 'u1',
      });
    });
    const db = ctx('u1', 'viewer');
    await assertFails(updateDoc(doc(db, 'users/u1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users/u1'), { active: true, role: 'finance' }));
    // ...but may edit their own name.
    await assertSucceeds(updateDoc(doc(db, 'users/u1'), { displayName: 'Abel' }));
  });
});

describe('contracts', () => {
  it('lets a viewer read but not write', async () => {
    const db = ctx('u1', 'viewer');
    await assertSucceeds(getDoc(doc(db, 'contracts/k1')));
    await assertFails(setDoc(doc(db, 'contracts/k1'), { ...CONTRACT, ...stamped('u1') }));
  });

  it('lets a manager create a contract whose VAT reconciles', async () => {
    const db = ctx('mgr', 'manager');
    await assertSucceeds(setDoc(doc(db, 'contracts/k1'), { ...CONTRACT, ...stamped('mgr') }));
  });

  it('REFUSES a contract whose VAT does not add up', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(
      setDoc(doc(db, 'contracts/k2'), {
        ...CONTRACT, valueGrossSantim: 999_999_00, ...stamped('mgr'),
      }),
    );
  });

  it('REFUSES money that is not an integer number of santim', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(
      setDoc(doc(db, 'contracts/k3'), {
        ...CONTRACT, valueNetSantim: 100_000.5, valueGrossSantim: 115_000.5, ...stamped('mgr'),
      }),
    );
  });

  it('refuses a create whose audit stamp names someone else', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(setDoc(doc(db, 'contracts/k4'), { ...CONTRACT, ...stamped('someone-else') }));
  });

  it('refuses a client-generated createdAt', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(
      setDoc(doc(db, 'contracts/k5'), {
        ...CONTRACT, createdAt: new Date(), updatedAt: serverTimestamp(),
        createdBy: 'mgr', updatedBy: 'mgr',
      }),
    );
  });

  it('stops finance creating contracts', async () => {
    const db = ctx('fin', 'finance');
    await assertFails(setDoc(doc(db, 'contracts/k6'), { ...CONTRACT, ...stamped('fin') }));
  });
});

describe('disbursements and WHT', () => {
  it('lets finance create a disbursement whose WHT reconciles', async () => {
    const db = ctx('fin', 'finance');
    await assertSucceeds(setDoc(doc(db, 'disbursements/d1'), { ...DISBURSEMENT, ...stamped('fin') }));
  });

  it('REFUSES WHT charged on the VAT-inclusive gross instead of the net', async () => {
    const db = ctx('fin', 'finance');
    await assertFails(
      setDoc(doc(db, 'disbursements/d2'), {
        ...DISBURSEMENT, whtBaseSantim: 115_000_00, ...stamped('fin'),
      }),
    );
  });

  it('REFUSES a net payable that does not equal gross less WHT', async () => {
    const db = ctx('fin', 'finance');
    await assertFails(
      setDoc(doc(db, 'disbursements/d3'), {
        ...DISBURSEMENT, netPayableSantim: 115_000_00, ...stamped('fin'),
      }),
    );
  });

  it('stops a manager creating disbursements', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(setDoc(doc(db, 'disbursements/d4'), { ...DISBURSEMENT, ...stamped('mgr') }));
  });

  it('freezes a paid disbursement', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'disbursements/d5'), {
        ...DISBURSEMENT, status: 'paid',
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'fin', updatedBy: 'fin',
      });
    });
    const db = ctx('fin', 'finance');
    await assertFails(
      updateDoc(doc(db, 'disbursements/d5'), { bankRef: 'X', updatedAt: serverTimestamp(), updatedBy: 'fin' }),
    );
  });
});

describe('engineers are kept out of the money', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'projects/p1'), {
        projectNo: 'P-1', title: 'Tower', status: 'in_progress', progressBps: 4000,
        financials: { contractNetSantim: 100, grossMarginSantim: 20 },
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'mgr', updatedBy: 'mgr',
      });
    });
  });

  it('lets an engineer update progress', async () => {
    const db = ctx('eng', 'engineer');
    await assertSucceeds(
      updateDoc(doc(db, 'projects/p1'), {
        progressBps: 5000, updatedAt: serverTimestamp(), updatedBy: 'eng',
      }),
    );
  });

  it('REFUSES an engineer editing the financial rollup', async () => {
    const db = ctx('eng', 'engineer');
    await assertFails(
      updateDoc(doc(db, 'projects/p1'), {
        financials: { contractNetSantim: 999, grossMarginSantim: 999 },
        updatedAt: serverTimestamp(), updatedBy: 'eng',
      }),
    );
  });
});

describe('callout timestamps are immutable', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'callouts/co1'), {
        calloutNo: 'CO-1', contractId: 'k1', clientId: 'cl1', unitTag: 'LIFT-01',
        technicianId: 'eng', status: 'on_site',
        reportedAt: new Date('2025-09-01T08:00:00Z'),
        arrivedAt: new Date('2025-09-01T08:45:00Z'),
        resolvedAt: null,
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'mgr', updatedBy: 'mgr',
      });
    });
  });

  it('REFUSES rewriting an arrival time that is already set', async () => {
    // Every SLA metric derives from these — a technician must not be able to
    // improve their own response time after the fact.
    const db = ctx('eng', 'engineer');
    await assertFails(
      updateDoc(doc(db, 'callouts/co1'), {
        arrivedAt: new Date('2025-09-01T08:05:00Z'),
        updatedAt: serverTimestamp(), updatedBy: 'eng',
      }),
    );
  });

  it('REFUSES rewriting the report time', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(
      updateDoc(doc(db, 'callouts/co1'), {
        reportedAt: new Date('2025-09-01T08:40:00Z'),
        updatedAt: serverTimestamp(), updatedBy: 'mgr',
      }),
    );
  });

  it('allows setting a resolution time that was still null', async () => {
    const db = ctx('eng', 'engineer');
    await assertSucceeds(
      updateDoc(doc(db, 'callouts/co1'), {
        resolvedAt: new Date('2025-09-01T10:15:00Z'),
        updatedAt: serverTimestamp(), updatedBy: 'eng',
      }),
    );
  });

  it('stops an engineer touching a callout assigned to somebody else', async () => {
    const db = ctx('other-eng', 'engineer');
    await assertFails(
      updateDoc(doc(db, 'callouts/co1'), {
        resolvedAt: new Date(), updatedAt: serverTimestamp(), updatedBy: 'other-eng',
      }),
    );
  });
});

describe('project phases', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'projects/p1/phases/ph1'), {
        seq: 1, key: 'shaft_prep', name: 'Shaft preparation', weightBps: 2000,
        progressBps: 0, status: 'not_started',
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'mgr', updatedBy: 'mgr',
      });
    });
  });

  it('lets an engineer move phase progress', async () => {
    const db = ctx('eng', 'engineer');
    await assertSucceeds(
      updateDoc(doc(db, 'projects/p1/phases/ph1'), {
        progressBps: 5000, status: 'in_progress',
        updatedAt: serverTimestamp(), updatedBy: 'eng',
      }),
    );
  });

  it('stops a viewer touching phase progress', async () => {
    const db = ctx('v', 'viewer');
    await assertFails(
      updateDoc(doc(db, 'projects/p1/phases/ph1'), {
        progressBps: 5000, updatedAt: serverTimestamp(), updatedBy: 'v',
      }),
    );
  });

  it('stops an engineer creating or deleting phases', async () => {
    const db = ctx('eng', 'engineer');
    await assertFails(
      setDoc(doc(db, 'projects/p1/phases/ph2'), {
        seq: 2, key: 'rail_installation', name: 'Rails', weightBps: 2500,
        progressBps: 0, status: 'not_started', ...stamped('eng'),
      }),
    );
    await assertFails(deleteDoc(doc(db, 'projects/p1/phases/ph1')));
  });

  it('refuses a phase update whose audit stamp names someone else', async () => {
    const db = ctx('eng', 'engineer');
    await assertFails(
      updateDoc(doc(db, 'projects/p1/phases/ph1'), {
        progressBps: 5000, updatedAt: serverTimestamp(), updatedBy: 'mgr',
      }),
    );
  });
});

describe('project assignments', () => {
  const ASSIGNMENT = {
    projectId: 'p1', technicianId: 't1', technicianName: 'Abel',
    role: 'lead', allocationBps: 6000, phaseIds: [], endDate: null, active: true,
  };

  it('lets a manager assign a technician', async () => {
    const db = ctx('mgr', 'manager');
    await assertSucceeds(setDoc(doc(db, 'projectAssignments/a1'), { ...ASSIGNMENT, ...stamped('mgr') }));
  });

  it('stops an engineer assigning themselves', async () => {
    // Allocation weights the project's team score, so only managers set it.
    const db = ctx('eng', 'engineer');
    await assertFails(setDoc(doc(db, 'projectAssignments/a2'), { ...ASSIGNMENT, ...stamped('eng') }));
  });

  it('lets anyone with read access see the crew', async () => {
    const db = ctx('v', 'viewer');
    await assertSucceeds(getDoc(doc(db, 'projectAssignments/a1')));
  });
});

describe('technicians', () => {
  it('lets a manager create one but never delete it', async () => {
    const db = ctx('mgr', 'manager');
    await assertSucceeds(
      setDoc(doc(db, 'technicians/t1'), {
        employeeNo: 'E-1', name: 'Abel', uid: null, subcontractorId: null,
        phone: '0911', trades: [], certifications: [],
        contractedMinutesPerWeek: 2400, status: 'active', ...stamped('mgr'),
      }),
    );
    // KPI history must survive; deactivate instead.
    await assertFails(deleteDoc(doc(db, 'technicians/t1')));
  });
});

describe('invoice sequence counters', () => {
  it('lets finance consume the next number', async () => {
    const db = ctx('fin', 'finance');
    await assertSucceeds(setDoc(doc(db, 'counters/invoice'), { value: 1, updatedAt: new Date() }));
    await assertSucceeds(
      setDoc(doc(db, 'counters/invoice'), { value: 2, updatedAt: new Date() }, { merge: true }),
    );
  });

  it('REFUSES rewinding a counter, which would reuse an invoice number', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'counters/invoice'), { value: 50 });
    });
    const db = ctx('fin', 'finance');
    await assertFails(setDoc(doc(db, 'counters/invoice'), { value: 10 }, { merge: true }));
    await assertFails(setDoc(doc(db, 'counters/invoice'), { value: 50 }, { merge: true }));
  });

  it('REFUSES skipping ahead, which would leave an unexplained gap', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'counters/invoice'), { value: 50 });
    });
    const db = ctx('fin', 'finance');
    await assertFails(setDoc(doc(db, 'counters/invoice'), { value: 99 }, { merge: true }));
  });

  it('stops a viewer or engineer consuming numbers, and nobody may delete one', async () => {
    await assertFails(setDoc(doc(ctx('v', 'viewer'), 'counters/invoice'), { value: 1 }));
    await assertFails(setDoc(doc(ctx('eng', 'engineer'), 'counters/invoice'), { value: 1 }));
    await assertFails(deleteDoc(doc(ctx('adm', 'admin'), 'counters/invoice')));
  });
});

describe('issued invoices are tax documents', () => {
  const INVOICE = {
    invoiceNo: 'INV-00001', clientId: 'cl1', clientName: 'Acme', clientTin: '001',
    contractId: null, projectId: null, milestoneId: null, currency: 'ETB',
    lines: [], netSantim: 100_000_00, vatRateBps: 1500, vatSantim: 15_000_00,
    grossSantim: 115_000_00, paidGrossSantim: 0, balanceGrossSantim: 115_000_00,
    status: 'draft', vatPeriodEc: 'EC-2018-01', vatPeriodGc: '2025-09',
  };

  it('REFUSES an invoice whose VAT does not reconcile', async () => {
    const db = ctx('fin', 'finance');
    await assertFails(
      setDoc(doc(db, 'invoices/i1'), { ...INVOICE, grossSantim: 999_999_00, ...stamped('fin') }),
    );
  });

  it('refuses to create an invoice that is already issued', async () => {
    // Numbers come from the counter at issue time, never at creation.
    const db = ctx('fin', 'finance');
    await assertFails(
      setDoc(doc(db, 'invoices/i2'), { ...INVOICE, status: 'issued', ...stamped('fin') }),
    );
  });

  it('freezes the number, net and VAT once issued', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'invoices/i3'), {
        ...INVOICE, status: 'issued',
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'fin', updatedBy: 'fin',
      });
    });
    const db = ctx('fin', 'finance');

    // Payment fields may move.
    await assertSucceeds(
      updateDoc(doc(db, 'invoices/i3'), {
        paidGrossSantim: 115_000_00, balanceGrossSantim: 0, status: 'paid',
        updatedAt: serverTimestamp(), updatedBy: 'fin',
      }),
    );
    // The tax figures may not.
    await assertFails(
      updateDoc(doc(db, 'invoices/i3'), {
        netSantim: 1, grossSantim: 1_15, vatSantim: 15,
        updatedAt: serverTimestamp(), updatedBy: 'fin',
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'invoices/i3'), {
        invoiceNo: 'INV-99999', updatedAt: serverTimestamp(), updatedBy: 'fin',
      }),
    );
  });

  it('stops an issued invoice being deleted, so the sequence stays explicable', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'invoices/i4'), {
        ...INVOICE, status: 'issued',
        createdAt: new Date(), updatedAt: new Date(), createdBy: 'fin', updatedBy: 'fin',
      });
    });
    await assertFails(deleteDoc(doc(ctx('adm', 'admin'), 'invoices/i4')));
  });

  it('stops a manager writing invoices at all', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(setDoc(doc(db, 'invoices/i5'), { ...INVOICE, ...stamped('mgr') }));
  });
});

describe('KPI snapshots and audit logs cannot be tampered with', () => {
  it('refuses every client write to a KPI snapshot', async () => {
    for (const role of ['admin', 'manager', 'engineer']) {
      const db = ctx(`u-${role}`, role);
      await assertFails(setDoc(doc(db, 'technicians/t1/kpiSnapshots/EC-2018-01'), { firstTimeFixBps: 10_000 }));
    }
  });

  it('makes audit logs append-only', async () => {
    const db = ctx('mgr', 'manager');
    await assertSucceeds(
      setDoc(doc(db, 'auditLogs/l1'), { at: serverTimestamp(), uid: 'mgr', action: 'create', collection: 'clients', docId: 'c1' }),
    );
    await assertFails(updateDoc(doc(db, 'auditLogs/l1'), { action: 'delete' }));
    await assertFails(deleteDoc(doc(db, 'auditLogs/l1')));
  });

  it('refuses a log entry attributed to someone else', async () => {
    const db = ctx('mgr', 'manager');
    await assertFails(
      setDoc(doc(db, 'auditLogs/l2'), { at: serverTimestamp(), uid: 'someone-else', action: 'create', collection: 'clients', docId: 'c1' }),
    );
  });
});

describe('config is admin-only', () => {
  it('lets anyone read tax config but only admins write it', async () => {
    const viewer = ctx('u1', 'viewer');
    await assertSucceeds(getDoc(doc(viewer, 'config/tax')));
    await assertFails(setDoc(doc(viewer, 'config/tax'), { vatRateBps: 0 }));

    const manager = ctx('mgr', 'manager');
    await assertFails(setDoc(doc(manager, 'config/tax'), { vatRateBps: 0 }));

    const admin = ctx('adm', 'admin');
    await assertSucceeds(setDoc(doc(admin, 'config/tax'), { vatRateBps: 1500 }));
  });
});

describe('unmatched collections are closed by default', () => {
  it('denies a collection the rules never mention', async () => {
    const db = ctx('adm', 'admin');
    await assertFails(setDoc(doc(db, 'somethingNew/x1'), { a: 1 }));
    await assertFails(getDoc(doc(db, 'somethingNew/x1')));
  });
});

/**
 * Detailed finance tools. Navigation to these routes lives in More tools;
 * receivables and project priority have their own primary workflows.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { Invoices } from './Invoices.js';
import { Disbursements } from './Disbursements.js';
import { Reports } from './Reports.js';
import { Returns } from './Returns.js';

export function Finance() {
  return (
    <Routes>
      <Route index element={<Navigate to="/collections" replace />} />
      <Route path="invoices" element={<Invoices />} />
      <Route path="disbursements" element={<Disbursements />} />
      <Route path="returns" element={<Returns />} />
      <Route path="reports" element={<Reports />} />
      <Route path="*" element={<Navigate to="/collections" replace />} />
    </Routes>
  );
}

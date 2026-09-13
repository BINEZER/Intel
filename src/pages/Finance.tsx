/**
 * Finance hub: invoices, disbursements and returns under one route.
 */

import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Invoices } from './Invoices.js';
import { Disbursements } from './Disbursements.js';
import { Reports } from './Reports.js';
import { Returns } from './Returns.js';

export function Finance() {
  return (
    <>
      <nav className="subnav">
        <NavLink to="invoices" className={({ isActive }) => (isActive ? 'active' : '')}>Invoices</NavLink>
        <NavLink to="disbursements" className={({ isActive }) => (isActive ? 'active' : '')}>Disbursements</NavLink>
        <NavLink to="returns" className={({ isActive }) => (isActive ? 'active' : '')}>Tax returns</NavLink>
        <NavLink to="reports" className={({ isActive }) => (isActive ? 'active' : '')}>Reports</NavLink>
      </nav>

      <Routes>
        <Route index element={<Navigate to="invoices" replace />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="disbursements" element={<Disbursements />} />
        <Route path="returns" element={<Returns />} />
        <Route path="reports" element={<Reports />} />
      </Routes>
    </>
  );
}

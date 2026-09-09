import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/context/auth-context';
import { ThemeProvider } from '@/context/theme-context';
import { ToastProvider } from '@/components/ui/toast';
import { ProtectedRoute } from '@/components/protected-route';
import { AppLayout } from '@/components/app-layout';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { EmployeeListPage } from '@/pages/employees/list';
import { EmployeeDetailPage } from '@/pages/employees/detail';
import { EmployeeCreatePage } from '@/pages/employees/create';
import { OrgChartPage } from '@/pages/org-chart';
import { DepartmentsPage } from '@/pages/departments';
import { LeavePage } from '@/pages/leave';
import { AttendancePage } from '@/pages/attendance';
import { AccessPage } from '@/pages/access';
import { AccountPage } from '@/pages/access/account';
import { PlatformAdminConsole } from '@/pages/platform-admin/console';

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/platform-admin/*" element={<PlatformAdminConsole />} />
          <Route
            path="/*"
            element={
              <AuthProvider>
                <Routes>
                  <Route path="login" element={<LoginPage />} />
                  <Route
                    element={
                      <ProtectedRoute>
                        <AppLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<DashboardPage />} />
                    <Route path="employees" element={<EmployeeListPage />} />
                    <Route path="employees/new" element={<EmployeeCreatePage />} />
                    <Route path="employees/:id" element={<EmployeeDetailPage />} />
                    <Route path="org-chart" element={<OrgChartPage />} />
                    <Route path="departments" element={<DepartmentsPage />} />
                    <Route path="leave" element={<LeavePage />} />
                    <Route path="attendance" element={<AttendancePage />} />
                    <Route path="access" element={<AccessPage />} />
                    <Route path="account" element={<AccountPage />} />
                  </Route>
                </Routes>
              </AuthProvider>
            }
          />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

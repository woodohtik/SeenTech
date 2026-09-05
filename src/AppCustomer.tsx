/**
 * AppCustomer — root component for the customer Android app
 * (seen-companion-app-android-task.md, Track B, Phase ب1).
 *
 * Deliberately NOT App.tsx. This is a separate, minimal router shipped in
 * its own build (see vite.customer.config.ts) so the public-facing
 * io.seentech.customer app never bundles the admin/POS surface -- only
 * the two screens a customer with no account ever needs: "my orders" and
 * a single order's tracking page.
 */
import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import OrderTracking from './components/public/OrderTracking';
import MyOrdersHome from './components/customer/MyOrdersHome';
import { initCustomerPushNotifications } from './lib/pushNotificationsCapacitorCustomer';

const TrackRoute = () => {
  const { token } = useParams();
  return <OrderTracking token={token || ''} />;
};

export default function AppCustomer() {
  useEffect(() => {
    void initCustomerPushNotifications();
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<MyOrdersHome />} />
        <Route path="/track/:token" element={<TrackRoute />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

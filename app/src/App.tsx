import { HashRouter, Route, Routes } from "react-router-dom";
import Home from "./routes/Home";
import Animals from "./routes/Animals";
import AnimalRecord from "./routes/AnimalRecord";
import Lactations from "./routes/Lactations";
import Milkings from "./routes/Milkings";
import Genetics from "./routes/Genetics";
import Sires from "./routes/Sires";
import StoreProducts from "./routes/StoreProducts";
import StoreOrders from "./routes/StoreOrders";
import Breedings from "./routes/Breedings";
import AlertsPage from "./routes/Alerts";
import BreedsPage from "./routes/Breeds";
import DepreciationPage from "./routes/Depreciation";
import GrazingPage from "./routes/Grazing";
import RotationPage from "./routes/Rotation";
import PastureMapPage from "./routes/PastureMap";
import ForageBalancePage from "./routes/ForageBalance";
import MonitoringPage from "./routes/Monitoring";
import GrazingPlanPage from "./routes/GrazingPlan";
import DecisionsPage from "./routes/Decisions";
import CalvingsPage from "./routes/Calvings";
import StoreCustomers from "./routes/StoreCustomers";
import StoreCustomerDetail from "./routes/StoreCustomerDetail";
import StoreSchedules from "./routes/StoreSchedules";
import StoreForecast from "./routes/StoreForecast";
import BooksTransactions from "./routes/BooksTransactions";
import BooksAccounts from "./routes/BooksAccounts";
import BooksReports from "./routes/BooksReports";
import BooksBalanceSheet from "./routes/BooksBalanceSheet";
import BooksTaxes from "./routes/BooksTaxes";
import CustomerStore from "./routes/CustomerStore";
import { AuthProvider } from "./lib/auth";
import { WorkspaceProvider } from "./lib/workspace";
import { RequireAuth } from "./components/auth/RequireAuth";
import { RequireModule } from "./components/auth/RequireModule";

// Hash routing rather than browser routing: this deploys to GitHub Pages
// (a static file host with no server-side rewrite config), so a clean
// /animals/1103-style deep link would 404 on refresh. Hash paths
// (#/animals/1103) resolve client-side with zero server config, and work
// identically on GitHub Pages, Vercel, Netlify, or a plain static bucket —
// portable over pretty URLs, for an internal family-farm tool.
export default function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <HashRouter>
          <Routes>
            <Route element={<RequireAuth />}>
              {/* One adaptive home: farm businesses get Today, everything
                  else gets Overview. See routes/Home.tsx. */}
              <Route path="/" element={<Home />} />
              {/* Everything below is module-gated — switching to a business
                  without the module bounces back to "/" rather than leaving
                  you on another business's screen. */}
              <Route element={<RequireModule />}>
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/animals" element={<Animals />} />
                <Route path="/animals/:tag" element={<AnimalRecord />} />
                <Route path="/lactations" element={<Lactations />} />
                <Route path="/milkings" element={<Milkings />} />
                <Route path="/genetics" element={<Genetics />} />
                <Route path="/sires" element={<Sires />} />
                <Route path="/breedings" element={<Breedings />} />
                <Route path="/calvings" element={<CalvingsPage />} />
                <Route path="/breeds" element={<BreedsPage />} />
                <Route path="/depreciation" element={<DepreciationPage />} />
                <Route path="/grazing" element={<GrazingPage />} />
                <Route path="/grazing/rotation" element={<RotationPage />} />
                <Route path="/grazing/map" element={<PastureMapPage />} />
                <Route path="/grazing/balance" element={<ForageBalancePage />} />
                <Route path="/grazing/monitoring" element={<MonitoringPage />} />
                <Route path="/grazing/plan" element={<GrazingPlanPage />} />
                <Route path="/grazing/decisions" element={<DecisionsPage />} />
                <Route path="/store/products" element={<StoreProducts />} />
                <Route path="/store/orders" element={<StoreOrders />} />
                <Route path="/store/customers" element={<StoreCustomers />} />
                <Route path="/store/customers/:id" element={<StoreCustomerDetail />} />
                <Route path="/store/schedules" element={<StoreSchedules />} />
                <Route path="/store/forecast" element={<StoreForecast />} />
                <Route path="/books/transactions" element={<BooksTransactions />} />
                <Route path="/books/accounts" element={<BooksAccounts />} />
                <Route path="/books/reports" element={<BooksReports />} />
                <Route path="/books/balance-sheet" element={<BooksBalanceSheet />} />
                <Route path="/books/taxes" element={<BooksTaxes />} />
              </Route>
            </Route>
            {/* Customer store sits outside the auth gate — a customer isn't
                a farm_members row. See RequireAuth's comment. */}
            <Route path="/shop" element={<CustomerStore />} />
          </Routes>
        </HashRouter>
      </WorkspaceProvider>
    </AuthProvider>
  );
}

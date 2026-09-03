import { HashRouter, Route, Routes } from "react-router-dom";
import Home from "./routes/Home";
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
import MarketPage from "./routes/MarketPage";
import RotationPage from "./routes/Rotation";
import GrazingPlanPage from "./routes/GrazingPlan";
import GrazingRecordPage from "./routes/GrazingRecord";
import MovePage from "./routes/Move";
import GrazingRecordsPage from "./routes/GrazingRecords";
import AnimalsPage from "./routes/AnimalsPage";
import MilkingPage from "./routes/MilkingPage";
import BreedingPage from "./routes/BreedingPage";
import SettingsPage from "./routes/Settings";
import MobsPage from "./routes/Mobs";
import PaymentRecordPage from "./routes/PaymentRecord";
import CalvingsPage from "./routes/Calvings";
import StoreCustomers from "./routes/StoreCustomers";
import StoreCustomerDetail from "./routes/StoreCustomerDetail";
import StoreSchedules from "./routes/StoreSchedules";
import StoreForecast from "./routes/StoreForecast";
import BooksTransactions from "./routes/BooksTransactions";
import BooksAccounts from "./routes/BooksAccounts";
import BooksCashFlow from "./routes/BooksCashFlow";
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
              {/* Signed in but not module-gated: settings are the reference
                  data any business configures, herd or not. */}
              <Route path="/settings" element={<SettingsPage />} />
              {/* Everything below is module-gated — switching to a business
                  without the module bounces back to "/" rather than leaving
                  you on another business's screen. */}
              <Route element={<RequireModule />}>
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/animals" element={<AnimalsPage />} />
                <Route path="/animals/:tag" element={<AnimalRecord />} />
                <Route path="/milking" element={<MilkingPage />} />
                <Route path="/breeding" element={<BreedingPage />} />
                <Route path="/lactations" element={<Lactations />} />
                <Route path="/milkings" element={<Milkings />} />
                <Route path="/genetics" element={<Genetics />} />
                <Route path="/sires" element={<Sires />} />
                <Route path="/breedings" element={<Breedings />} />
                <Route path="/calvings" element={<CalvingsPage />} />
                <Route path="/breeds" element={<BreedsPage />} />
                <Route path="/depreciation" element={<DepreciationPage />} />
                <Route path="/market" element={<MarketPage />} />
                <Route path="/grazing" element={<GrazingPage />} />
                <Route path="/grazing/move" element={<MovePage />} />
                <Route path="/grazing/records" element={<GrazingRecordsPage />} />
                <Route path="/grazing/mobs" element={<MobsPage />} />
                <Route path="/grazing/rotation" element={<RotationPage />} />
                <Route path="/grazing/plan" element={<GrazingPlanPage />} />
                <Route path="/grazing/record" element={<GrazingRecordPage />} />
                <Route path="/grazing/payment-record" element={<PaymentRecordPage />} />
                <Route path="/store/products" element={<StoreProducts />} />
                <Route path="/store/orders" element={<StoreOrders />} />
                <Route path="/store/customers" element={<StoreCustomers />} />
                <Route path="/store/customers/:id" element={<StoreCustomerDetail />} />
                <Route path="/store/schedules" element={<StoreSchedules />} />
                <Route path="/store/forecast" element={<StoreForecast />} />
                <Route path="/books/transactions" element={<BooksTransactions />} />
                <Route path="/books/accounts" element={<BooksAccounts />} />
                <Route path="/books/reports" element={<BooksReports />} />
                <Route path="/books/cash-flow" element={<BooksCashFlow />} />
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

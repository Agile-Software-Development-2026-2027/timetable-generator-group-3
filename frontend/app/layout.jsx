import "bootstrap/dist/css/bootstrap.min.css";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/breezy/theme.css";
import "@fullcalendar/react/themes/breezy/palettes/rose.css";
import "./style.css";
import "./theme.css";
import "./tables.css";
import "./calendar.css";
import { AuthProvider } from "./components/auth-provider.jsx";

export const metadata = {
  title: "University of Calabria | Timetable Generator",
  description: "Set up University of Calabria degree programmes for timetable planning.",
};

export default function RootLayout({ children }) {
  return <html lang="en" suppressHydrationWarning><body><AuthProvider>{children}</AuthProvider></body></html>;
}

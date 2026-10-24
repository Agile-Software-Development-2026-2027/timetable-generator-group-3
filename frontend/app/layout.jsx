import "bootstrap/dist/css/bootstrap.min.css";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/breezy/theme.css";
import "@fullcalendar/react/themes/breezy/palettes/emerald.css";
import "./style.css";

export const metadata = {
  title: "University of Calabria | Timetable Generator",
  description: "Set up University of Calabria degree programmes for timetable planning.",
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}

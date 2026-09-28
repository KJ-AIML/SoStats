import { CalendarPlus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/sostats/page-heading";
import { CalendarView } from "./calendar-view";

export default function CalendarPage() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Calendar"
        title="Plan every channel in one view"
        description="Review coverage, spot gaps and move approved content into the right publishing window."
        actions={
          <>
            <Button variant="outline" className="h-10 rounded-xl text-[10px]">
              <Filter className="mr-2 h-3.5 w-3.5" />
              Channels
            </Button>
            <Button className="h-10 rounded-xl bg-[#ef2b2d] text-[10px] hover:bg-[#da2427]">
              <CalendarPlus className="mr-2 h-3.5 w-3.5" />
              Schedule content
            </Button>
          </>
        }
      />
      <CalendarView />
    </div>
  );
}

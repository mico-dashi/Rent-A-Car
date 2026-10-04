import { ScrollView, Text, View } from "react-native";
import { formatDate } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { shiftDays, toUtcIso, withHour } from "@/lib/datetime";
import { Button, Chip, Label, Row } from "@/lib/ui";
import { useTenant } from "@/lib/tenant";

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Dependency-free date + hour picker in the branch's timezone (no native date picker module needed). */
export function DateStepper({ label, value, onChange, timeZone, lang, prevLabel, nextLabel }: {
  label: string; value: string; onChange: (v: string) => void; timeZone: string; lang: LanguageCode; prevLabel: string; nextLabel: string;
}) {
  const { theme } = useTenant();
  const hour = Number(value.slice(11, 13));
  return (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <View style={{ width: 56 }}><Button title="‹" variant="ghost" onPress={() => onChange(shiftDays(value, -1))} accessibilityHint={prevLabel} /></View>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.text, fontSize: 17, fontWeight: "700", flex: 1, textAlign: "center" }}>
          {formatDate(toUtcIso(value, timeZone), timeZone, lang)}
        </Text>
        <View style={{ width: 56 }}><Button title="›" variant="ghost" onPress={() => onChange(shiftDays(value, 1))} accessibilityHint={nextLabel} /></View>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {HOURS.map((h) => <Chip key={h} label={`${String(h).padStart(2, "0")}:00`} selected={h === hour} onPress={() => onChange(withHour(value, h))} />)}
      </ScrollView>
    </View>
  );
}

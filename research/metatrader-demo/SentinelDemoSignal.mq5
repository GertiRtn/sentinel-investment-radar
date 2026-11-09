// Sentinel MT5 demo research monitor. This file NEVER submits orders.
#property strict
#property version "0.1"
#property description "Demo-account-only daily momentum observation; no orders."

input int LookbackDays = 28;
input int RefreshSeconds = 60;
input int MaxQuoteAgeMinutes = 15;

datetime last_bar = 0;
string last_status = "";

void ShowStatus(const string status)
{
   Comment("SENTINEL | DEMO RESEARCH MONITOR\n",
           "Observation only - no trades are sent\n",
           "Symbol: ", _Symbol, " | Rule: ", LookbackDays, " completed daily bars\n",
           status);
   if(status != last_status)
   {
      Print("Sentinel observation | symbol=", _Symbol, " | ", status);
      last_status = status;
   }
}

bool DemoConnected()
{
   return (bool)TerminalInfoInteger(TERMINAL_CONNECTED)
       && AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO;
}

int OnInit()
{
   if(LookbackDays < 1 || LookbackDays > 365 || RefreshSeconds < 10 || MaxQuoteAgeMinutes < 1)
      return INIT_PARAMETERS_INCORRECT;
   if(!DemoConnected())
   {
      Print("Sentinel: connect to a demo account before starting.");
      return INIT_FAILED;
   }
   if(!EventSetTimer(RefreshSeconds))
      return INIT_FAILED;
   ShowStatus("Waiting for the first observation.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTick()
{
   // Timer handles observations so an inactive market is also reported.
}

void OnTimer()
{
   if(!DemoConnected())
   {
      ShowStatus("PAUSED: demo account disconnected or account changed.");
      last_bar = 0;
      return;
   }

   MqlTick tick;
   datetime now = TimeCurrent();
   if(!SymbolInfoTick(_Symbol, tick) || tick.time <= 0 || now <= 0 ||
      now < tick.time || now - tick.time > MaxQuoteAgeMinutes * 60)
   {
      ShowStatus("UNKNOWN: market quote is missing or stale.");
      return;
   }

   MqlRates bars[];
   ArraySetAsSeries(bars, true);
   int count = CopyRates(_Symbol, PERIOD_D1, 1, LookbackDays + 1, bars);
   if(count != LookbackDays + 1 || bars[0].close <= 0 ||
      bars[LookbackDays].close <= 0 || bars[0].time <= 0 ||
      bars[LookbackDays].time <= 0 || bars[0].time >= now)
   {
      ShowStatus("UNKNOWN: sufficient completed daily price history is unavailable.");
      return;
   }
   if(bars[0].time == last_bar && last_status != "" &&
      StringFind(last_status, "UNKNOWN:") != 0)
      return;

   last_bar = bars[0].time;
   string direction = bars[0].close > bars[LookbackDays].close
                      ? "Rule observation: above earlier close."
                      : "Rule observation: at or below earlier close.";
   ShowStatus(direction + "\nLatest completed daily bar opened: " +
              TimeToString(bars[0].time, TIME_DATE | TIME_MINUTES) +
              " (broker server time).\nValues: " + DoubleToString(bars[0].close, _Digits) +
              " vs " + DoubleToString(bars[LookbackDays].close, _Digits) +
              ".\nThis is a research observation, not an order.");
}

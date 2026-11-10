// Sentinel Strategy Tester research prototype. Never submits to a live terminal.
// NOT VALIDATED: compile and run only in MT5 Strategy Tester.
#property strict
#property version "1.02"
#property description "Strategy Tester only; daily momentum research prototype."

input int LookbackDays = 28;
input double Lots = 0.01;
input int MaxSpreadPoints = 30;
input int StopLossPoints = 500;
input int DeviationPoints = 20;

const ulong Magic = 72026001;
datetime evaluated_day = 0;
datetime retry_day = 0;
datetime retry_deadline = 0;
datetime next_retry = 0;
bool halted = false;

void Status(string message)
{
   Comment("SENTINEL | STRATEGY TESTER ONLY\n", message,
           "\nThis is a research test, not proven profitable.");
   Print("Sentinel tester | ", message);
}

bool TesterOnly()
{
   // Defense in depth: test again immediately before every submission.
   return (bool)MQLInfoInteger(MQL_TESTER) &&
          AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO;
}

int OnInit()
{
   if(!TesterOnly())
   {
      Print("Sentinel: requires MT5 Strategy Tester and a demo account.");
      return INIT_FAILED;
   }
   if(LookbackDays < 1 || LookbackDays > 365 || Lots <= 0 || Lots > 0.01 ||
      MaxSpreadPoints < 1 || StopLossPoints < 1 || DeviationPoints < 0)
      return INIT_PARAMETERS_INCORRECT;
   // Require a clean start: do not take control of any pre-existing positions
   // or outstanding orders, even if they appear to belong to this strategy.
   if(PositionsTotal() != 0 || OrdersTotal() != 0)
   {
      Print("Sentinel: start the tester with no existing positions or orders.");
      return INIT_FAILED;
   }
   Status("Ready. Waiting for daily price data.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { Comment(""); }

// Return 0 for no position, 1 for one owned long position, -1 for ambiguity.
int OwnedPosition(ulong &ticket, double &volume)
{
   int found = 0;
   ticket = 0;
   volume = 0;
   if(OrdersTotal() != 0) return -1;
   for(int i = 0; i < PositionsTotal(); ++i)
   {
      ulong current = PositionGetTicket(i);
      if(current == 0) return -1;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         (ulong)PositionGetInteger(POSITION_MAGIC) != Magic ||
         PositionGetInteger(POSITION_TYPE) != POSITION_TYPE_BUY)
         return -1;
      ++found;
      ticket = current;
      volume = PositionGetDouble(POSITION_VOLUME);
   }
   if(found > 1 || (found == 1 && (volume <= 0 || volume > 0.01000001)))
      return -1;
   return found;
}

bool Submit(MqlTradeRequest &request)
{
   if(!TesterOnly()) { Status("HALTED: tester/demo check failed."); return false; }
   MqlTradeCheckResult check = {};
   ResetLastError();
   if(!OrderCheck(request, check) || check.retcode != 0)
   {
      PrintFormat("Sentinel check failed: retcode=%u error=%d %s",
                  check.retcode, GetLastError(), check.comment);
      return false;
   }
   // OrderCheck does not guarantee execution; an accepted request is not a fill.
   if(!TesterOnly()) return false;
   MqlTradeResult result = {};
   ResetLastError();
   bool sent = OrderSend(request, result);
   PrintFormat("Sentinel request: sent=%s retcode=%u order=%I64u deal=%I64u volume=%.4f comment=%s error=%d",
               sent ? "true" : "false", result.retcode, result.order, result.deal,
               result.volume, result.comment, GetLastError());
   // Anything other than a full, confirmed fill halts; never retry blindly.
   if(!sent || result.retcode != TRADE_RETCODE_DONE ||
      result.deal == 0 || MathAbs(result.volume - request.volume) > 0.00000001)
      return false;
   return true;
}

void OnTick()
{
   if(halted) return;
   if(!TesterOnly()) { halted = true; Status("HALTED: tester/demo check failed."); return; }
   datetime current_day = iTime(_Symbol, PERIOD_D1, 0);
   if(current_day <= 0 || current_day == evaluated_day) return;
   datetime now = TimeCurrent();
   if(now <= 0) return;
   if(retry_day != current_day)
   {
      retry_day = current_day;
      retry_deadline = now + 3600;
      next_retry = now;
      PrintFormat("Sentinel retry window: day=%s start=%s deadline=%s interval_seconds=300",
                  TimeToString(current_day, TIME_DATE | TIME_MINUTES),
                  TimeToString(now, TIME_DATE | TIME_SECONDS),
                  TimeToString(retry_deadline, TIME_DATE | TIME_SECONDS));
   }
   if(now > retry_deadline)
   {
      evaluated_day = current_day;
      Status("SKIPPED: spread retry window expired; no further checks today.");
      return;
   }
   if(now < next_retry) return;
   // At most one decision for a bar, including when an order is rejected.
   evaluated_day = current_day;
   MqlRates bars[];
   ArraySetAsSeries(bars, true);
   if(CopyRates(_Symbol, PERIOD_D1, 1, LookbackDays + 1, bars) != LookbackDays + 1 ||
      bars[0].close <= 0 || bars[LookbackDays].close <= 0)
   { Status("SKIPPED: insufficient completed daily history."); return; }
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick) || tick.bid <= 0 || tick.ask <= 0 ||
      tick.ask < tick.bid || tick.time <= 0 || tick.time != TimeCurrent())
   { Status("SKIPPED: invalid quote."); return; }
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minvol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxvol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double ticksize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(point <= 0 || step <= 0 || ticksize <= 0)
   {
      Status(StringFormat("SKIPPED: invalid symbol settings. point=%.8f volume_step=%.8f tick_size=%.8f",
                          point, step, ticksize));
      return;
   }
   if(Lots < minvol || Lots > maxvol ||
      MathAbs(Lots / step - MathRound(Lots / step)) > 0.0000001)
   {
      Status(StringFormat("SKIPPED: invalid volume. requested=%.4f minimum=%.4f maximum=%.4f step=%.4f",
                          Lots, minvol, maxvol, step));
      return;
   }
   double spread_points = (tick.ask - tick.bid) / point;
   if(spread_points > MaxSpreadPoints)
   {
      Status(StringFormat("WAITING: spread %.1f points exceeds limit %d; bid=",
                          spread_points, MaxSpreadPoints) + DoubleToString(tick.bid, _Digits) +
             " ask=" + DoubleToString(tick.ask, _Digits));
      // Retry only a high spread; every order attempt remains once per day.
      // OnTick runs on quotes, so checks happen at or after this time.
      evaluated_day = 0;
      next_retry = now + 300;
      return;
   }
   ulong ticket;
   double volume;
   int position = OwnedPosition(ticket, volume);
   if(position < 0) { halted = true; Status("HALTED: unexpected position or order."); return; }
   bool positive = bars[0].close > bars[LookbackDays].close;
   PrintFormat("Sentinel decision: symbol=%s completed_bar=%s close=%.5f prior=%.5f positive=%s position=%d spread_points=%.1f",
               _Symbol, TimeToString(bars[0].time, TIME_DATE | TIME_MINUTES),
               bars[0].close, bars[LookbackDays].close, positive ? "true" : "false",
               position, (tick.ask - tick.bid) / point);
   if((positive && position == 1) || (!positive && position == 0))
   { Status("No change: holding the current test state."); return; }

   MqlTradeRequest request = {};
   request.action = TRADE_ACTION_DEAL;
   request.symbol = _Symbol;
   request.magic = Magic;
   request.deviation = (ulong)DeviationPoints;
   request.type_filling = ORDER_FILLING_FOK;
   request.comment = "Sentinel tester";
   if(positive)
   {
      double stop = MathFloor((tick.bid - StopLossPoints * point) / ticksize) * ticksize;
      stop = NormalizeDouble(stop, _Digits);
      long stops = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
      if(stop <= 0 || tick.bid - stop < stops * point)
      { Status("SKIPPED: stop price violates symbol limits."); return; }
      request.type = ORDER_TYPE_BUY;
      request.volume = Lots;
      request.price = tick.ask;
      request.sl = stop;
   }
   else
   {
      request.type = ORDER_TYPE_SELL;
      request.position = ticket;
      request.volume = volume;
      request.price = tick.bid;
   }
   if(!Submit(request))
   { halted = true; Status("HALTED: order rejected or outcome uncertain. Inspect the journal."); return; }
   Status(positive ? "A test buy was filled." : "The test position was closed.");
}

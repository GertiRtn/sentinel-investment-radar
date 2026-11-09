import sys,json
from pathlib import Path
from datetime import date
from hashlib import sha256
sys.path.insert(0,"research/study3-momentum")
import backtest as b
b.WARMUP=date(2022,12,1); b.START=date(2023,1,1); b.END=date(2024,6,30)
b.months=lambda: iter(["2022-12"]+[f"{y}-{m:02}" for y in (2023,2024) for m in range(1,(12 if y==2023 else 6)+1)])
data=Path("research/study3-momentum/data")
out={}
for s,n in (("BTCUSDT",28),("ETHUSDT",14)):
 bars,manifest=b.load(s,data,True)
 out[s]={"selected":n,"validation":b.simulate(bars,"momentum",n),"cash":b.simulate(bars,"cash"),"buy_and_hold":b.simulate(bars,"hold"),"delay":b.simulate(bars,"momentum",n,delay=1),"manifest":manifest}
Path("research/study3-momentum/validation.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
print(json.dumps(out,indent=2))

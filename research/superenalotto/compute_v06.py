import itertools
from math import comb
import numpy as np
import pandas as pd
from numba import njit

ROOT='/mnt/data/'
df=pd.read_csv(ROOT+'estrazioni_con_ritardi.csv',sep=';',encoding='utf-8-sig')
df['data']=pd.to_datetime(df['data'])
df=df.sort_values(['data','concorso']).reset_index(drop=True)
nums=df[[f'n{i}' for i in range(1,7)]].to_numpy(dtype=np.int16)
N=len(nums)
# categories: [1],[2,3],[4],[5,6],[7],[8,13],[14,19],[20,28],[29,40],[41,69],[70,81], >81 not eligible
cat=np.full(500, -1,dtype=np.int8)
for i,(lo,hi) in enumerate([(1,1),(2,3),(4,4),(5,6),(7,7),(8,13),(14,19),(20,28),(29,40),(41,69),(70,81)]):cat[lo:hi+1]=i
# state automaton, sorted delay category multiset
states=[tuple()]
starts=[0]
for k in range(1,7):
 starts.append(len(states))
 states += list(itertools.combinations_with_replacement(range(11),k))
starts.append(len(states))
lookup={s:i for i,s in enumerate(states)}
next_state=np.full((len(states),11),-1,dtype=np.int32)
for si,s in enumerate(states):
 if len(s)<6:
  for c in range(11):
   next_state[si,c]=lookup[tuple(sorted((*s,c)))]
mask=np.zeros(len(states),dtype=np.int8)
# F09-F14 tests on six sorted delay values
for si in range(starts[6],starts[7]):
 s=states[si]
 tests=[s[0]<=4,s[1]<=5,1<=s[2]<=6,2<=s[3]<=7,3<=s[4]<=8,4<=s[5]<=9]
 mask[si]=sum(int(b)<<j for j,b in enumerate(tests))
# numeric position intervals F03-F08
limits=np.array([(1,36),(3,54),(10,68),(25,81),(38,87),(57,90)],dtype=np.int16)
# prepare past delays for each draw, only after all 90 appeared
last=np.full(91,-1,dtype=np.int32)
delays=np.zeros((N,91),dtype=np.int16)
valid=np.zeros(N,dtype=np.bool_)
for i in range(N):
 if np.all(last[1:]>=0):
  valid[i]=True
  delays[i,1:]=i-last[1:]
 for x in nums[i]:last[x]=i
assert valid.sum()==4226

@njit
def calculate(nums, delays, valid, cat, starts, next_state, mask, limits):
 n=len(nums)
 # baseline histogram by 6-bit pass mask; 0 is valid baseline but none new
 hist=np.zeros((n,64),dtype=np.int64)
 hits=np.zeros((n,64),dtype=np.int8)
 for i in range(n):
  if not valid[i]:continue
  dp=np.zeros(next_state.shape[0],dtype=np.int64)
  dp[0]=1
  for x in range(1,91):
   d=delays[i,x]
   if d<1 or d>81:continue
   c=cat[d]
   for k in range(5,-1,-1):
    if x<limits[k,0] or x>limits[k,1]:continue
    for si in range(starts[k],starts[k+1]):
     count=dp[si]
     if count:
      dp[next_state[si,c]]+=count
  # Include only max delay >=8 (F01)
  for si in range(starts[6],starts[7]):
   if states_last_cat[si]>=5:
    hist[i,mask[si]]+=dp[si]
  # F02 subtract previously drawn combos that satisfy F01 and numeric positions
  for old in range(i):
   pos_ok=True
   for k in range(6):
    x=nums[old,k]
    if x<limits[k,0] or x>limits[k,1]:
     pos_ok=False
     break
   if not pos_ok:continue
   ds=np.empty(6,dtype=np.int16)
   maxd=0
   for k in range(6):
    d=delays[i,nums[old,k]]
    ds[k]=d
    if d>maxd:maxd=d
   if maxd<8 or maxd>81:continue
   ds.sort()
   bits=0
   if ds[0]>=1 and ds[0]<=7:bits|=1
   if ds[1]>=1 and ds[1]<=13:bits|=2
   if ds[2]>=2 and ds[2]<=19:bits|=4
   if ds[3]>=4 and ds[3]<=28:bits|=8
   if ds[4]>=5 and ds[4]<=40:bits|=16
   if ds[5]>=7 and ds[5]<=69:bits|=32
   hist[i,bits]-=1
  # winning combo
  pos_ok=True
  for k in range(6):
   x=nums[i,k]
   if x<limits[k,0] or x>limits[k,1]:
    pos_ok=False
    break
  if pos_ok:
   ds=np.empty(6,dtype=np.int16)
   maxd=0
   for k in range(6):
    d=delays[i,nums[i,k]]
    ds[k]=d
    if d>maxd:maxd=d
   if 8<=maxd<=81:
    ds.sort()
    bits=0
    if 1<=ds[0]<=7:bits|=1
    if 1<=ds[1]<=13:bits|=2
    if 2<=ds[2]<=19:bits|=4
    if 4<=ds[3]<=28:bits|=8
    if 5<=ds[4]<=40:bits|=16
    if 7<=ds[5]<=69:bits|=32
    hits[i,bits]=1
 return hist,hits

states_last_cat=np.array([s[-1] if s else -1 for s in states],dtype=np.int8)
print('computing...',len(states),starts, flush=True)
hist,hits=calculate(nums,delays,valid,cat,np.array(starts,dtype=np.int32),next_state,mask,limits)
print('computed',flush=True)
rows=[]
for i in np.flatnonzero(valid):
 h=hist[i]; w=hits[i]
 row={'date':df.loc[i,'data'].strftime('%Y-%m-%d'),'baseline_count':int(h.sum()),'baseline_hit':int(w.sum())}
 for k in range(1,7):
  bit=1<<(k-1)
  row[f'individual_F{8+k:02}_count']=int(h[np.arange(64)&bit==bit].sum())
  row[f'individual_F{8+k:02}_hit']=int(w[np.arange(64)&bit==bit].sum())
  subset=(1<<k)-1
  row[f'cumulative_F{8+k:02}_count']=int(h[np.arange(64)&subset==subset].sum())
  row[f'cumulative_F{8+k:02}_hit']=int(w[np.arange(64)&subset==subset].sum())
 rows.append(row)
res=pd.DataFrame(rows)
old=pd.read_csv(ROOT+'superenalotto_filtri_posizione_dettaglio_v04.csv')
assert (res.date.values==old.date.values).all()
print('base count equal', (res.baseline_count.values==old.count_0.values).all(),'hits equal',(res.baseline_hit.values==old.hit_0.values).all())
if not (res.baseline_count.values==old.count_0.values).all():
 dif=np.flatnonzero(res.baseline_count.values!=old.count_0.values)
 print('first differences',dif[:10],[(res.iloc[t].date,res.iloc[t].baseline_count,old.iloc[t].count_0) for t in dif[:5]])
res.to_csv(ROOT+'superenalotto_filtri_ritardi_dettaglio_v06.csv',index=False)
print('total',comb(90,6),'n',len(res))
for prefix in ['baseline']+[f'individual_F{k:02}' for k in range(9,15)]+[f'cumulative_F{k:02}' for k in range(9,15)]:
 cnt=int(res[prefix+'_count'].sum());hit=int(res[prefix+'_hit'].sum());
 print(prefix,'mean',cnt/len(res),'remain%',100*cnt/(len(res)*comb(90,6)),'hits',hit,'coverage%',100*hit/len(res))

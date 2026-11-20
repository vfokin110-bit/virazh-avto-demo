'use strict';
const shop = JSON.parse(document.querySelector('#shop').textContent);
const escaped = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText = new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
const dayLabel = d => dateText.format(new Date(d+'T12:00:00Z'));
const slotLabel = s => dayLabel(s.slice(0,10))+' · '+s.slice(11);
const money = n => new Intl.NumberFormat('ru-RU').format(n)+' ₽';
const visitStates = {pending:'Ожидает подтверждения',confirmed:'Запись подтверждена',canceled:'Запись отменена'};
async function request(path,body) {
  const r = await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error || 'Попробуйте позже.'),{status:r.status});
  return data;
}
const bookingForm = document.querySelector('#booking-form');
let bookingSchedule = null;
let submitToken = null;
let payloadKey = null;
let activeDay = null;
let chosen = null;
function showTime() {
  const box=bookingForm.querySelector('[data-times]');
  const day=bookingSchedule.days.find(x=>x.day===activeDay);
  box.innerHTML=day?day.slots.map(s=>'<button class="slot" type="button" aria-pressed="'+(s.slot===chosen)+'" data-time="'+s.slot+'">'+s.slot.slice(11)+'</button>').join(''):'';
  bookingForm.querySelector('button[type=submit]').disabled=!chosen;
  bookingForm.querySelector('[data-slot-message]').textContent=chosen?'Выбрано: '+slotLabel(chosen)+', местное время.':'Время указано для Нижнего Тагила.';
}
function showDays() {
  const box=bookingForm.querySelector('[data-days]');
  if(!bookingSchedule.days.length){
    box.innerHTML='<p class="subtle">До '+dayLabel(bookingSchedule.lastDay)+' свободных мест нет. <a class="back" href="tel:'+shop.tel+'">Позвонить в сервис</a></p>';
    showTime();
    return;
  }
  const first=bookingSchedule.days[0].day;
  if(!bookingSchedule.days.some(d=>d.day===activeDay))activeDay=first;
  box.innerHTML=bookingSchedule.days.map(d=>'<button class="slot" type="button" aria-pressed="'+(d.day===activeDay)+'" data-day="'+d.day+'">'+dayLabel(d.day)+'</button>').join('');
  showTime();
}
async function startBooking(){
  if(!bookingForm)return;
  const params=new URLSearchParams(location.search);
  const selected=params.get('usluga'), time=params.get('vremya');
  if(selected){
    const option=[...bookingForm.querySelectorAll('[name=items]')].find(field=>field.value===selected);
    if(option)option.checked=true;
  }
  bookingForm.addEventListener('submit',submit);
  try {
    bookingSchedule=await request('/api/schedule');
    if(time&&bookingSchedule.days.some(d=>d.slots.some(s=>s.slot===time))){
      activeDay=time.slice(0,10);
      chosen=time;
    }
    showDays();
    if(time&&!chosen)bookingForm.querySelector('[data-slot-message]').textContent='Это время уже недоступно. Выберите другое.';
  } catch(e){bookingForm.querySelector('[data-days]').textContent=e.message}
}
async function submit(event) {
  event.preventDefault();
  const form=event.target, fields=new FormData(form), displayError=form.querySelector('.error'), button=form.querySelector('button[type=submit]');
  if(button.disabled)return;
  const body={...Object.fromEntries(fields),items:fields.getAll('items'),slot:chosen};
  if(!body.items.length){displayError.textContent='Выберите хотя бы одну услугу.';return;}
  if(!chosen){displayError.textContent='Выберите свободное время.';return;}
  const fingerprint=JSON.stringify(body);
  if(payloadKey!==fingerprint){submitToken=crypto.randomUUID();payloadKey=fingerprint;}
  button.disabled=true;
  displayError.textContent='';
  try {
    await request('/api/bookings',{...body,token:submitToken});
    location.href='/status/#'+submitToken;
  } catch(e){
    if(e.status===409){
      chosen=null;
      try {bookingSchedule=await request('/api/schedule');showDays();}catch{}
    }
    displayError.textContent=e.message;
    button.disabled=!chosen;
  }
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b)return;
  if(b.dataset.day){
    activeDay=b.dataset.day;chosen=null;showDays();
    bookingForm.querySelector('[aria-pressed=true][data-day]')?.focus();
  }
  else if(b.dataset.time){chosen=b.dataset.time;showTime();bookingForm.querySelector('[aria-pressed=true][data-time]')?.focus();}
  else if(b.dataset.filter){
    document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',x===b));
    document.querySelectorAll('[data-category]').forEach(x=>x.hidden=b.dataset.filter!=='Все услуги'&&x.dataset.category!==b.dataset.filter);
  }
});
async function status(){
  const box=document.querySelector('#booking-status');
  if(!box)return;
  const token=location.hash.slice(1);
  if(!token){box.textContent='Откройте ссылку из вашей заявки.';return;}
  try{
    const data=await request('/api/status',{token});
    const visiblePay=data.method==='online'&&data.state==='confirmed'&&data.payment!=='succeeded'&&data.canPay;
    box.innerHTML='<span class="statuspill" data-state="'+data.state+'">'+visitStates[data.state]+'</span><h2>'+escaped(data.id)+'</h2>'
      +'<p><strong>'+slotLabel(data.slot)+'</strong> · местное время</p><ul>'+data.items.map(i=>'<li>'+escaped(i.name)+'</li>').join('')+'</ul>'
      +(data.state==='confirmed' && data.quote>0 ? '<p>Сумма заказа · <b>'+money(data.quote)+'</b></p>' : '<p><a class="price-link" href="tel:'+shop.tel+'">Уточнить стоимость</a></p>')
      +'<p>'+(data.payment==='succeeded'?'Онлайн-оплата получена.':data.method==='onsite'?'Оплата в сервисе после работ.':'Вы выбрали онлайн-оплату после подтверждения.')+'</p>'
      +(visiblePay?(data.online?'<button class="prime" id="pay">Оплатить онлайн</button>':'<p class="subtle">Онлайн-оплата пока подключается. Можно уточнить способ оплаты у сервиса.</p>'):'')
      +'<p class="subtle">Сохраните ссылку, чтобы проверить подтверждение или новое время.</p><p><a class="back" href="tel:'+shop.tel+'">Связаться с сервисом</a></p><p id="payment-error" class="error" role="alert"></p>';
    const pay=box.querySelector('#pay');
    if(pay)pay.addEventListener('click',async ()=>{
      pay.disabled=true;
      try{const p=await request('/api/pay',{token});location.assign(p.redirect);}
      catch(e){box.querySelector('#payment-error').textContent=e.message;pay.disabled=false;}
    });
  }catch(e){box.textContent=e.message;}
}
startBooking();
status();
window.addEventListener('hashchange',status);


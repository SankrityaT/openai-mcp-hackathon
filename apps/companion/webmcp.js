const CARDEA_ORIGIN = __CARDEA_ORIGIN__;
const items = [
  { id:"lumen-lamp", name:"Lumen lamp", description:"Warm adjustable light for a first night.", price:72, accent:"#ff6b4a" },
  { id:"fold-stool", name:"Fold stool", description:"A compact seat that stores flat.", price:48, accent:"#445cff" },
  { id:"linen-set", name:"Linen set", description:"Two-piece washed cotton bedding.", price:96, accent:"#9ab5a2" },
  { id:"entry-tray", name:"Entry tray", description:"A small landing place for keys and mail.", price:34, accent:"#d7b66f" },
];
const cart = new Map();
const catalog = document.querySelector("#catalog");
const cartNode = document.querySelector("#cart");
const status = document.querySelector("#status");

function renderCatalog(list=items){catalog.innerHTML=list.map(item=>`<article style="--accent:${item.accent}"><i></i><h2>${item.name}</h2><p>${item.description}</p><button data-id="${item.id}">Prepare · $${item.price}</button></article>`).join("");}
function renderCart(){const rows=[...cart.entries()];cartNode.innerHTML=rows.length?rows.map(([id,qty])=>{const item=items.find(x=>x.id===id);return `<div><span>${item.name} × ${qty}</span><b>$${item.price*qty}</b></div>`}).join(""):"Nothing prepared yet.";}
function updateCart(itemId,quantity){if(!items.some(item=>item.id===itemId))throw new Error("Unknown item");if(!Number.isInteger(quantity)||quantity<0||quantity>10)throw new Error("Invalid quantity");if(quantity===0)cart.delete(itemId);else cart.set(itemId,quantity);renderCart();return {items:[...cart.entries()].map(([id,qty])=>({id,quantity:qty})),simulated:true};}
catalog.addEventListener("click",event=>{const button=event.target.closest("button[data-id]");if(button)updateCart(button.dataset.id,(cart.get(button.dataset.id)||0)+1);});
renderCatalog();renderCart();

if(document.modelContext){
  const exposedTo=[CARDEA_ORIGIN];
  const schema=(properties,required=[])=>({type:"object",additionalProperties:false,properties,required});
  const tools=[
    {name:"search_catalog",description:"Search the visible Threshold Supply catalog by a short query.",inputSchema:schema({query:{type:"string",minLength:1,maxLength:120}},["query"]),annotations:{readOnlyHint:true},execute:async({query})=>{const q=query.toLowerCase();const results=items.filter(item=>`${item.name} ${item.description}`.toLowerCase().includes(q));renderCatalog(results);return JSON.stringify({results,visibleEffect:"catalog_filtered"});}},
    {name:"get_item",description:"Read details for one catalog item.",inputSchema:schema({itemId:{type:"string",minLength:1,maxLength:80}},["itemId"]),annotations:{readOnlyHint:true},execute:async({itemId})=>JSON.stringify(items.find(item=>item.id===itemId)||null)},
    {name:"compare_items",description:"Compare two to four catalog items without changing state.",inputSchema:schema({itemIds:{type:"array",items:{type:"string"},minItems:2,maxItems:4}},["itemIds"]),annotations:{readOnlyHint:true},execute:async({itemIds})=>JSON.stringify({items:items.filter(item=>itemIds.includes(item.id))})},
    {name:"update_cart",description:"Prepare or update the simulated visible cart. No purchase or payment occurs.",inputSchema:schema({itemId:{type:"string"},quantity:{type:"integer",minimum:0,maximum:10}},["itemId","quantity"]),execute:async({itemId,quantity})=>JSON.stringify(updateCart(itemId,quantity))},
    {name:"read_policies",description:"Read the companion site's simulated commerce policies.",inputSchema:schema({}),annotations:{readOnlyHint:true},execute:async()=>JSON.stringify({checkout:"Not available",payment:"No real payment",returns:"Fixture only"})},
  ];
  Promise.all(tools.map(tool=>document.modelContext.registerTool(tool,{exposedTo}))).then(()=>{status.textContent="Five WebMCP tools are available to the trusted Cardea origin.";});
}

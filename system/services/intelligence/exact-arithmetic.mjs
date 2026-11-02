// Bounded deterministic arithmetic inside the canonical consultative Intelligence
// owner. Never a shell, generic expression evaluator or second LLM.
export const EXACT_ARITHMETIC_ENGINE_ID = "ordax-exact-arithmetic";
export const EXACT_ARITHMETIC_MODEL_ID = "rational-v1";
const MAX_INPUT=240, MAX_EXPRESSION=160, MAX_OPERATIONS=24, MAX_DEPTH=8;
const MAX_INTEGER_DIGITS=40, MAX_DECIMAL_DIGITS=20;
function gcd(a,b){while(b!==0n)[a,b]=[b,a%b];return a<0n?-a:a;}
function rational(n,d=1n){
  if(d===0n)return null;
  if(d<0n){n=-n;d=-d;}
  const c=gcd(n,d);n/=c;d/=c;
  if(n.toString().replace("-","").length>MAX_INTEGER_DIGITS ||
     d.toString().length>MAX_INTEGER_DIGITS)
    throw RangeError("Exact arithmetic range exceeded");
  return {n,d};
}
function extract(raw){
  if(typeof raw!=="string"||!raw.trim()||raw.length>MAX_INPUT||/[\u0000-\u001f\u007f]/u.test(raw))
    return null;
  let input=raw.trim();
  const wrappers=[
    /^qual\s+[ée]\s+(.+?)\s*\?\s*(?:responda\s+somente\s+com\s+o\s+n[uú]mero[.!]?)?$/iu,
    /^quanto\s+[ée]\s+(.+?)\s*\??$/iu,
    /^calcule\s+(.+?)\s*[.!]?$/iu,
    /^what\s+is\s+(.+?)\s*\?\s*(?:answer\s+(?:with\s+)?(?:only|just)\s+(?:the\s+)?number[.!]?)?$/iu,
    /^calculate\s+(.+?)\s*[.!]?$/iu,
  ];
  const wrapper=wrappers.find(item=>item.test(input));
  if(wrapper)input=input.match(wrapper)[1].trim();
  else if(!/^[\d\s()+\-*/xX×÷.,−–]+$/u.test(input))return null;
  if(input.length>MAX_EXPRESSION)return null;
  return input.replace(/\bdividido\s+por\b/giu,"/")
    .replace(/\bvezes\b/giu,"*").replace(/\bmais\b/giu,"+")
    .replace(/\bmenos\b/giu,"-").replace(/[×xX]/gu,"*")
    .replace(/÷/gu,"/").replace(/[−–]/gu,"-");
}
function parse(input){
  const tokens=[];let offset=0;
  while(offset<input.length){
    if(/\s/u.test(input[offset])){offset++;continue;}
    const fragment=input.slice(offset);
    const matched=/^(?:\d+(?:[.,]\d+)?|[.,]\d+)/u.exec(fragment);
    if(matched){
      const literal=matched[0],digits=literal.replace(/[.,]/gu,"");
      if(digits.length>18)return null;
      const [whole,fraction=""]=literal.replace(",",".").split(".");
      tokens.push({kind:"number",value:rational(BigInt((whole||"0")+fraction),10n**BigInt(fraction.length))});
      offset+=literal.length;
    }else{
      const c=input[offset++];
      if(!"+-*/()".includes(c))return null;
      tokens.push({kind:c});
    }
    if(tokens.length>80)return null;
  }
  let at=0,operations=0,depth=0;
  function factor(){
    if(++depth>MAX_DEPTH)throw RangeError("Nesting exceeded");
    try{
      let negative=false;
      if(tokens[at]?.kind==="+"||tokens[at]?.kind==="-")negative=tokens[at++].kind==="-";
      let value;
      if(tokens[at]?.kind==="number")value=tokens[at++].value;
      else if(tokens[at]?.kind==="("){
        at++;value=sum();if(tokens[at++]?.kind!==")")return null;
      }else return null;
      return negative&&value?rational(-value.n,value.d):value;
    }finally{depth--;}
  }
  function term(){
    let value=factor();
    while(value&&(tokens[at]?.kind==="*"||tokens[at]?.kind==="/")){
      const op=tokens[at++].kind;
      if(++operations>MAX_OPERATIONS)throw RangeError("Operator limit");
      const rhs=factor();if(!rhs)return null;
      value=op==="*"?rational(value.n*rhs.n,value.d*rhs.d):
        rational(value.n*rhs.d,value.d*rhs.n);
      if(!value)throw Error("DIVIDE_ZERO");
    }
    return value;
  }
  function sum(){
    let value=term();
    while(value&&(tokens[at]?.kind==="+"||tokens[at]?.kind==="-")){
      const op=tokens[at++].kind;
      if(++operations>MAX_OPERATIONS)throw RangeError("Operator limit");
      const rhs=term();if(!rhs)return null;
      value=op==="+"?rational(value.n*rhs.d+rhs.n*value.d,value.d*rhs.d):
        rational(value.n*rhs.d-rhs.n*value.d,value.d*rhs.d);
    }
    return value;
  }
  try{
    const value=sum();
    return value&&at===tokens.length?{kind:"exact",value}:null;
  }catch(error){return error.message==="DIVIDE_ZERO"?{kind:"division-by-zero"}:null;}
}
function exactText(value,locale){
  let d=value.d,twos=0,fives=0;
  while(d%2n===0n){d/=2n;twos++;}
  while(d%5n===0n){d/=5n;fives++;}
  const places=Math.max(twos,fives);
  if(d!==1n||places>MAX_DECIMAL_DIGITS)return value.n.toString()+"/"+value.d.toString();
  const neg=value.n<0n?"-":"";
  const n=value.n<0n?-value.n:value.n;
  if(places===0)return value.n.toString();
  const digits=(n*10n**BigInt(places)/value.d).toString().padStart(places+1,"0");
  const whole=digits.slice(0,-places),fraction=digits.slice(-places).replace(/0+$/u,"");
  const separator=locale==="en-US"?".":",";
  return neg+whole+(fraction?separator+fraction:"");
}
export function solveExactArithmetic(prompt,{locale="pt-BR"}={}){
  if(!["pt-BR","en-US","es-ES","de-DE","fr-FR"].includes(locale))
    throw TypeError("Unsupported arithmetic locale");
  const expression=extract(prompt);if(!expression)return null;
  const result=parse(expression);if(!result)return null;
  const text=result.kind==="division-by-zero"?
    ({"pt-BR":"Divisão por zero não é definida.",
      "en-US":"Division by zero is undefined.",
      "es-ES":"La división por cero no está definida.",
      "de-DE":"Division durch null ist nicht definiert.",
      "fr-FR":"La division par zéro est indéfinie."})[locale]:
    exactText(result.value,locale);
  return Object.freeze({text,kind:result.kind,
    engineId:EXACT_ARITHMETIC_ENGINE_ID,modelId:EXACT_ARITHMETIC_MODEL_ID});
}

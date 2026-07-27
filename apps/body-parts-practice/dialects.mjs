export const DIALECTS = [
  [1,"阿美","南勢阿美語","ami_Sout"],[2,"阿美","秀姑巒阿美語","ami_Xiug"],[3,"阿美","海岸阿美語","ami_Coas"],[4,"阿美","馬蘭阿美語","ami_Mala"],[5,"阿美","恆春阿美語","ami_Heng"],
  [6,"泰雅","賽考利克泰雅語","tay_Seko"],[7,"泰雅","澤敖利泰雅語","tay_Zeao"],[8,"泰雅","汶水泰雅語","tay_Wens"],[9,"泰雅","萬大泰雅語","tay_Wand"],[10,"泰雅","四季泰雅語","tay_Four"],[11,"泰雅","宜蘭澤敖利泰雅語","tay_Yzea"],
  [13,"賽夏","賽夏語","xsy_Sais"],[14,"邵","邵語","ssf_Thao"],[15,"賽德克","都達賽德克語","trv_Duda"],[16,"賽德克","德固達雅賽德克語","trv_Tegu"],[17,"賽德克","德鹿谷賽德克語","trv_Delu"],
  [18,"布農","卓群布農語","bnn_Zhuo"],[19,"布農","卡群布農語","bnn_Kaqu"],[20,"布農","丹群布農語","bnn_Tanq"],[21,"布農","巒群布農語","bnn_Luan"],[22,"布農","郡群布農語","bnn_Junq"],
  [23,"排灣","東排灣語","pwn_East"],[24,"排灣","北排灣語","pwn_Nrth"],[25,"排灣","中排灣語","pwn_Cent"],[26,"排灣","南排灣語","pwn_Sout"],
  [27,"魯凱","東魯凱語","dru_East"],[28,"魯凱","霧台魯凱語","dru_Wuta"],[29,"魯凱","大武魯凱語","dru_Dawu"],[30,"魯凱","多納魯凱語","dru_Dona"],[31,"魯凱","茂林魯凱語","dru_Maol"],[32,"魯凱","萬山魯凱語","dru_Wans"],
  [33,"太魯閣","太魯閣語","trv_Truk"],[34,"噶瑪蘭","噶瑪蘭語","ckv_Kava"],[35,"鄒","鄒語","tsu_Tsou"],[36,"卡那卡那富","卡那卡那富語","xnb_Kana"],[37,"拉阿魯哇","拉阿魯哇語","sxr_Saar"],
  [38,"卑南","南王卑南語","pyu_Nanw"],[39,"卑南","知本卑南語","pyu_Zhib"],[40,"卑南","西群卑南語","pyu_Xiqu"],[41,"卑南","建和卑南語","pyu_Jian"],[42,"雅美","雅美語","tao_Yami"],[43,"撒奇萊雅","撒奇萊雅語","szy_Saki"]
].map(([id, ethnicity, name, code]) => ({ id, ethnicity, name, code }));

export const ETHNICITIES = [...new Set(DIALECTS.map((item) => item.ethnicity))];
export const dialectById = (id) => DIALECTS.find((item) => item.id === Number(id));

const LocalStrategy = require('passport-local').Strategy;
// const bcrypt = require('bcrypt');

function initialize(passport, getUserByEmail, fn2) {
  const authenticateUser = async (email, password, done) => {
    const userJson = await getUserByEmail(email);
    // const userJson = JSON.parse(user);

    if (userJson == null) {
      return done(null, false, { message: 'No user with that email' });
    }

    try {
      if (password === userJson.password) {
        return done(null, userJson);
      } else {
        return done(null, false, { message: 'Password incorrect' });
      }
    } catch (e) {
      console.log(e);

      return done(e);
    }
  };

  passport.use(new LocalStrategy({ usernameField: 'email' }, authenticateUser));
  passport.serializeUser((userJson, done) => {
    console.log('serialize' + userJson.email);

    done(null, userJson.email);
  });
  passport.deserializeUser((email, done) => {
    console.log(email);

    return done(null, fn2(email));
  });
}

module.exports = initialize;
